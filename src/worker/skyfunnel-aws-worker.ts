import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SES_SKYFUNNEL_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AddSESEmailRouteParamsSchema, Email } from "../server/types/emailQueue";
import { AppError, errorHandler } from "../lib/errorHandler";
import { cache__getCampaignById, cache__getOrganizationSubscription, getSuppressedEmail } from "../db/emailQueries";
import { getEmailBody, getEmailSubject } from "../lib/email";
import { sendEmailSES } from "../lib/aws";
import {
  Days,
  Debug,
  delayAllSkyfCampaignJobsTillNextValidTime,
  getNextActiveTime,
  isActiveDay,
  isWithinPeriod,
} from "../lib/utils";
import { usageRedisStore } from "../lib/usageRedisStore";

const handleJob = async (job: Job) => {
  console.log("[SKYFUNNEL_WORKER] Job Started with jobID", job.id);
  const data = job.data;
  try {
    const validatedData = AddSESEmailRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      throw new AppError("BAD_REQUEST", validatedData.error.errors[0].message);
    }

    const { email, campaignOrg } = validatedData.data;
    const { startTimeInUTC, endTimeInUTC, activeDays, timezone } = email;

    const isActiveDayValue = isActiveDay(activeDays as Days[], timezone ?? undefined);
    const isWithinTimeRange = isWithinPeriod(startTimeInUTC, endTimeInUTC);

    if (!isWithinTimeRange || !isActiveDayValue) {
      const nextActiveDateTime = getNextActiveTime(activeDays as Days[], startTimeInUTC!);
      console.log(
        `[SKYFUNNEL_WORKER] Out-of-time job detected. Rescheduling all jobs to ${nextActiveDateTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
      );
      await delayAllSkyfCampaignJobsTillNextValidTime(job, nextActiveDateTime);
      return;
    }

    await sendEmailAndUpdateStatus(email, campaignOrg);
  } catch (error) {
    errorHandler(error, true);
  }
};

async function sendEmailAndUpdateStatus(email: Email, campaignOrg: { name: string; id: string }) {
  const campaignPromise = cache__getCampaignById(email.emailCampaignId);
  const organizationSubscriptionPromise = await cache__getOrganizationSubscription(campaignOrg.id);

  const [campaign, orgSubscription] = await Promise.all([campaignPromise, organizationSubscriptionPromise]);

  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");
  if (!orgSubscription) throw new AppError("NOT_FOUND", "Organization not found");

  const isEmailsBlocked = orgSubscription.isEmailBlocked;
  if (isEmailsBlocked) {
    console.log("Emails are blocked for organization " + campaignOrg.id);
    // TODO: Add a status "BLOCKED" to the email
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["ERROR", email.id]);

    // Silent return if emails are blocked. as we don't want to retry sending emails to blocked emails
    return;
  }
  const organizationId = campaignOrg.id;
  const orgUsage = await usageRedisStore.getUsage(organizationId);
  Debug.log("Usage of organization " + organizationId + " is " + orgUsage);
  if (orgUsage >= orgSubscription.allowedEmails) {
    Debug.log(
      `Organization ${organizationId} has reached its limit of ${orgUsage}/${orgSubscription.allowedEmails} emails`,
    );

    Promise.all([
      query('UPDATE "EmailCampaign" SET "status" = $1 WHERE id = $2', ["LIMIT",email.emailCampaignId]),
      query('UPDATE "Email" SET status = $1 WHERE id = $2', ["LIMIT", email.id]),
    ]);
    return;
  }
  const suppressedResults = await getSuppressedEmail(email.leadEmail);

  const { emailBodyHTML, footer, header } = getEmailBody({
    campaignId: email.emailCampaignId,
    rawBodyHTML: campaign.campaignContentType === "TEXT" ? campaign.plainTextBody : campaign.bodyHTML,
    emailId: email.id,
    leadFirstName: email.leadFirstName || "",
    leadLastName: email.leadLastName || "",
    leadEmail: email.leadEmail,
    leadCompanyName: email.leadCompanyName || "",
    leadId: email.leadId,
    organizationName: campaignOrg.name,
    subscriptionType: orgSubscription.leadManagementModuleType,
  });

  const emailSubject = getEmailSubject({
    subject: campaign.subject,
    leadFirstName: email.leadFirstName || "",
    leadLastName: email.leadLastName || "",
    leadEmail: email.leadEmail,
    leadCompanyName: email.leadCompanyName || "",
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
    senderEmail: email.senderEmail,
    senderName: campaign.senderName,
    body: header + emailBodyHTML + footer,
    recipient: email.leadEmail,
    subject: emailSubject,
    replyToEmail: campaign.replyToEmail,
    campaignId: email.emailCampaignId,
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

    await usageRedisStore.incrementUsage(organizationId);

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
