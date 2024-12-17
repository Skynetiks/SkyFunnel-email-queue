import { smtpQueue } from "./../server/emails";
import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SMTP_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AppError, errorHandler } from "../lib/errorHandler";
import { getCampaignById, getLeadById, getSuppressedEmail, getUserById } from "../db/emailQueries";
import { getEmailBody } from "../lib/email";
import { generateJobId, getDelayedJobId } from "../lib/utils";
import { AddSMTPRouteParamsSchema, AddSMTPRouteParamsType, SMTPCredentials } from "../server/types/smtpQueue";
import { sendSMTPEmail, smtpErrorHandler } from "../lib/smtp";
import { Email } from "../server/types/emailQueue";

const handleJob = async (job: Job) => {
  console.log("[SMTP_WORKER] Job Started with jobID", job.id);
  const data = job.data;
  try {
    const validatedData = AddSMTPRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      throw new AppError("BAD_REQUEST", validatedData.error.errors[0].message);
    }

    const { email, campaignOrg, smtpCredentials } = validatedData.data;
    const isPaused = await smtpQueue.isCampaignPaused(email.emailCampaignId);
    console.log("isPaused", isPaused);
    if (isPaused) {
      const DELAY_TIME = 1000 * QUEUE_CONFIG.delayAfterPauseInSeconds;

      try {
        const queue = smtpQueue.getQueue();
        const newJobId = getDelayedJobId(job.id || generateJobId(email.emailCampaignId, email.id, "SES"));
        await queue.add(email.id, data, { ...job.opts, delay: DELAY_TIME, jobId: newJobId });
        console.log(`[SMTP_WORKER] New delayed job added to queue with a delay of ${DELAY_TIME} ms`);
      } catch (moveError) {
        console.error("[SMTP_WORKER] Failed to move job to delayed queue", moveError);
      }

      return;
    }

    await sendEmailAndUpdateStatus(email, campaignOrg, smtpCredentials, job);
  } catch (error) {
    errorHandler(error, true);
  }
};

async function sendEmailAndUpdateStatus(
  email: Email,
  campaignOrg: { name: string; id: string },
  smtpCredentials: SMTPCredentials,
  job: Job<AddSMTPRouteParamsType>,
) {
  const leadResultsPromise = getLeadById(email.leadId);
  const userResultsPromise = getUserById(email.senderId);
  const campaignPromise = getCampaignById(email.emailCampaignId);

  const [lead, user, campaign] = await Promise.all([leadResultsPromise, userResultsPromise, campaignPromise]);

  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");

  const suppressedResults = await getSuppressedEmail(lead.email);

  const { emailBodyHTML, footer, header } = getEmailBody({
    campaignId: email.emailCampaignId,
    rawBodyHTML: campaign.bodyHTML,
    emailId: email.id,
    leadFirstName: email.leadFirstName || "",
    leadLastName: email.leadLastName || "",
    leadEmail: email.leadEmail,
    leadCompanyName: email.leadCompanyName || "",
    leadId: lead.id,
    organizationName: campaignOrg.name,
  });

  if (suppressedResults) {
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["SUPPRESS", email.id]);
    await query('UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1', [
      email.emailCampaignId,
    ]);
    await query(
      'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
      [email.id, "BOUNCE", new Date().toISOString(), email.emailCampaignId],
    );
    console.log("Suppressed email " + email.id);
    return;
  }

  try {
    const emailSent = await sendSMTPEmail(
      {
        senderEmail: campaign.senderEmail,
        senderName: campaign.senderName,
        body: header + emailBodyHTML + footer,
        recipient: email.leadEmail,
        subject: campaign.subject,
        replyToEmail: campaign.replyToEmail,
      },
      smtpCredentials,
    );

    if (emailSent && emailSent.accepted && emailSent.messageId) {
      const updateEmailResult = query('UPDATE "Email" SET status = $1 WHERE id = $2', [
        "SENT",
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
      console.error("[SMTP_WORKER] Error While Sending Emails via AWS", emailSent ? emailSent.response : "");
      throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by AWS");
    }
  } catch (error) {
    smtpErrorHandler(error, job);
  }
}


const redisUrl = process.env.REDIS_URL;
const worker = new Worker(SMTP_EMAIL_QUEUE_KEY, handleJob, {
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
  console.log("[SMTP_WORKER] Job completed");
});

worker.on("ready", () => {
  console.log("[SMTP_WORKER] Worker is ready");
});
