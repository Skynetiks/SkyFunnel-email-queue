import { skyfunnelSesQueue } from "./../server/emails";
import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SES_SKYFUNNEL_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AddSESEmailRouteParamsSchema, Email } from "../server/types/emailQueue";
import { AppError, errorHandler } from "../lib/errorHandler";
import { getCampaignById, getLeadById, getOrganizationById, getOrganizationSubscription, getSuppressedEmail, getUserById } from "../db/emailQueries";
import { getEmailBody } from "../lib/email";
import { sendEmailSES } from "../lib/aws";
import { generateJobId, getDelayedJobId } from "../lib/utils";

const handleJob = async (job: Job) => {
  console.log("[SKYFUNNEL_WORKER] Job Started with jobID", job.id);
  const data = job.data;
  try {
    const validatedData = AddSESEmailRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      throw new AppError("BAD_REQUEST", validatedData.error.errors[0].message);
    }

    const { email, campaignOrg } = validatedData.data;
    const isPaused = await skyfunnelSesQueue.isCampaignPaused(email.emailCampaignId);
    console.log("isPaused", isPaused);
    if (isPaused) {
      const DELAY_TIME = 1000 * QUEUE_CONFIG.delayAfterPauseInSeconds;

      try {
        const queue = skyfunnelSesQueue.getQueue();
        const newJobId = getDelayedJobId(job.id || generateJobId(email.emailCampaignId, email.id, "SES"));
        await queue.add(email.id, data, { ...job.opts, delay: DELAY_TIME, jobId: newJobId });
        console.log(`[SKYFUNNEL_WORKER] New delayed job added to queue with a delay of ${DELAY_TIME} ms`);
      } catch (moveError) {
        console.error("[SKYFUNNEL_WORKER] Failed to move job to delayed queue", moveError);
      }

      return;
    }

    await sendEmailAndUpdateStatus(email, campaignOrg);
  } catch (error) {
    errorHandler(error, true);
  }
};


async function sendEmailAndUpdateStatus(email: Email, campaignOrg: { name: string; id: string }) {
  const leadResultsPromise = getLeadById(email.leadId);
  const userResultsPromise = getUserById(email.senderId);
  const campaignPromise = getCampaignById(email.emailCampaignId);
  const organizationPromise = getOrganizationById(campaignOrg.id);

  const [lead, user, campaign, organization] = await Promise.all([leadResultsPromise, userResultsPromise, campaignPromise, organizationPromise]);

  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");
  if (!organization) throw new AppError("NOT_FOUND", "Organization not found");

  const isEmailsBlocked = organization.isEmailBlocked;
  if (isEmailsBlocked) {
    console.log("Emails are blocked for organization " + organization.id);
    // TODO: Add a status "BLOCKED" to the email
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["ERROR", email.id]);

    // Silent return if emails are blocked. as we don't want to retry sending emails to blocked emails
    return;
  }

  const suppressedResults = await getSuppressedEmail(lead.email);
  const organizationSubscription = await getOrganizationSubscription(organization.orgSubscriptionId);

  const { emailBodyHTML, footer, header } = getEmailBody({
    campaignId: email.emailCampaignId,
    rawBodyHTML: campaign.campaignContentType === "TEXT" ? campaign.plainTextBody : campaign.bodyHTML,
    emailId: email.id,
    leadFirstName: email.leadFirstName || "",
    leadLastName: email.leadLastName || "",
    leadEmail: email.leadEmail,
    leadCompanyName: email.leadCompanyName || "",
    leadId: lead.id,
    organizationName: campaignOrg.name,
    subscriptionType: organizationSubscription.leadManagementModuleType
  });

  if (suppressedResults) {
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["SUPPRESS", email.id]);
    await query('UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1', [
      email.emailCampaignId,
    ]);
    await query(
      'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
      [email.id, "SUPPRESS", new Date().toISOString(), email.emailCampaignId],
    );
    console.log("[SKYFUNNEL_WORKER] Suppressed email " + email.id);
    return;
  }


  const emailSent = await sendEmailSES({
    senderEmail: campaign.senderEmail,
    senderName: campaign.senderName,
    body: header + emailBodyHTML + footer,
    recipient: lead.email,
    subject: campaign.subject,
    replyToEmail: campaign.replyToEmail,
  });

  if (emailSent && emailSent.success && emailSent.message?.MessageId) {
    const updateEmailResult = query('UPDATE "Email" SET status = $1, "messageId" = $2 WHERE id = $3', [
      "SENT",
      emailSent.message.MessageId || "",
      email.id,
    ]);

    const updateCampaignResult = query(
      'UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1',
      [email.emailCampaignId],
    );

    const updateOrganizationResult = query(
      'UPDATE "Organization" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1',
      [campaignOrg.id],
    );

    const addDeliveryEventResult = query(
      'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
      [email.id, "DELIVERY", new Date().toISOString(), email.emailCampaignId],
    );

    await Promise.all([updateEmailResult, updateCampaignResult, updateOrganizationResult, addDeliveryEventResult]);
  } else {
    console.error("[SKYFUNNEL_WORKER] Error While Sending Emails via AWS", emailSent ? emailSent.error : "");
    throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by AWS");
  }
}

const redisUrl = process.env.REDIS_URL;
const worker = new Worker(SES_SKYFUNNEL_EMAIL_QUEUE_KEY, handleJob, {
  concurrency: QUEUE_CONFIG.concurrency,
  connection: {
    url: redisUrl,
  },
  lockDuration: 30000,
});

worker.on("failed", async (job) => {
  if (job && "id" in job.data.email) {
    console.log("Updating email status to ERROR");
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["ERROR", job.data.email.id]);
  }

  console.error("[SMTP_WORKER] Job failed");
});

worker.on("completed", () => {
  console.log("[SKYFUNNEL_WORKER] Job completed");
});

worker.on("ready", () => {
  console.log("[SKYFUNNEL_WORKER] Worker is ready");
});
