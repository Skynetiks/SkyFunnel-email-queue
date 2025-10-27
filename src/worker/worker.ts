import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SMTP_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AppError, errorHandler } from "../lib/errorHandler";
import {
  cache__getCampaignById,
  cache__getOrganizationSubscription,
  getSuppressedEmail,
  cache__getSmtpCredentials,
} from "../db/emailQueries";
import { getEmailBody, getEmailSubject, getUnsubscribeLink, maskEmail } from "../lib/email";
import {
  Days,
  delayAllSMTPCampaignJobsTillNextValidTime,
  getNextActiveTime,
  isActiveDay,
  isWithinPeriod,
} from "../lib/utils";
import { Debug } from "../lib/debug";
import { AddSMTPRouteParamsSchema, AddSMTPRouteParamsType, Email } from "../server/types/smtpQueue";
import { sendSMTPEmail, smtpErrorHandler } from "../lib/smtp";
import { usageRedisStore } from "../lib/usageRedisStore";
import { UnsubscribeTokenPayload } from "../lib/token";

const handleJob = async (job: Job) => {
  console.log("[SMTP_WORKER] Job Started with jobID", job.id);
  const data = job.data;

  try {
    const validatedData = AddSMTPRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      throw new AppError("BAD_REQUEST", validatedData.error.errors[0].message);
    }

    const { email, campaignOrg } = validatedData.data;
    const { startTimeInUTC, endTimeInUTC, activeDays, timezone } = email;

    const isWithinPeriodValue = isWithinPeriod(startTimeInUTC, endTimeInUTC);
    const isActiveDayValue = isActiveDay(activeDays as Days[], timezone ?? undefined);

    if (!isWithinPeriodValue || !isActiveDayValue) {
      const nextActiveDateTime = getNextActiveTime(activeDays as Days[], startTimeInUTC!);
      console.log(
        `[SMTP_WORKER] Out-of-time job detected. Rescheduling all jobs to ${nextActiveDateTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
      );
      await delayAllSMTPCampaignJobsTillNextValidTime(job, nextActiveDateTime);
      return;
    }

    await sendEmailAndUpdateStatus(email, campaignOrg, job);
  } catch (error) {
    errorHandler(error, true);
  }
};

async function getSmtpCredentials(email: Email) {
  const smtpCredentials = await cache__getSmtpCredentials(email.senderEmail);
  if (!smtpCredentials) {
    throw new AppError("NOT_FOUND", `SMTP credentials not found for senderEmail: ${email.senderEmail}`);
  }
  return smtpCredentials;
}

async function sendEmailAndUpdateStatus(
  email: Email,
  campaignOrg: { name: string; id: string },
  job: Job<AddSMTPRouteParamsType>,
) {
  const organizationId = campaignOrg.id;
  const campaignPromise = cache__getCampaignById(email.emailCampaignId, campaignOrg.id);
  const smtpCredentials = await getSmtpCredentials(email);
  const organizationSubscriptionPromise = await cache__getOrganizationSubscription(organizationId);

  const [campaign, organizationSubscription] = await Promise.all([campaignPromise, organizationSubscriptionPromise]);

  console.log({
    email,
    organizationSubscription,
    campaign,
  });

  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");
  if (!organizationSubscription) throw new AppError("NOT_FOUND", "Organization Subscription not found");

  const orgUsage = await usageRedisStore.getUsage(organizationId);
  Debug.log("Usage of organization " + organizationId + " is " + orgUsage);
  if (orgUsage >= organizationSubscription.allowedEmails) {
    Debug.log(
      `Organization ${organizationId} has reached its limit of ${orgUsage}/${organizationSubscription.allowedEmails} emails`,
    );

    Promise.all([
      query('UPDATE "EmailCampaign" SET "status" = $1 WHERE id = $2', ["LIMIT", email.emailCampaignId]),
      query('UPDATE "Email" SET status = $1 WHERE id = $2', ["LIMIT", email.id]),
    ]);
    return;
  }

  const suppressedResults = await getSuppressedEmail(email.email);

  const { emailBodyHTML, header, hasUnsubscribeLink, footer } = getEmailBody({
    campaignId: email.emailCampaignId,
    rawBodyHTML: campaign.campaignContentType === "TEXT" ? campaign.plainTextBody : campaign.bodyHTML,
    emailId: email.id,
    firstName: email.firstName || "",
    lastName: email.lastName || "",
    email: email.email,
    companyName: email.companyName || "",
    recipientType: email.recipientType,
    leadId: email.leadId,
    clientId: email.clientId,
    organizationName: campaignOrg.name,
    subscriptionType: organizationSubscription.leadManagementModuleType,
    leadDoubleOptInToken: email.leadDoubleOptInToken || "",
  });

  const unsubscribeTokenPayload: UnsubscribeTokenPayload = {
    recipientType: email.recipientType,
    leadId: email.leadId,
    clientId: email.clientId,
    email: maskEmail(email.email),
    campaignId: email.emailCampaignId,
    reason: "User clicked the unsubscribe link/button in their email client",
    type: "unsubscribe",
  };

  const unsubscribeLink = getUnsubscribeLink(hasUnsubscribeLink, unsubscribeTokenPayload);

  const emailSubject = getEmailSubject({
    subject: campaign.subject,
    firstName: email.firstName || "",
    lastName: email.lastName || "",
    email: email.email,
    companyName: email.companyName || "",
  });

  if (suppressedResults) {
    Debug.devLog("UPDATING EMAIL STATUS TO SUPPRESS FOR EMAIL ID: ", email.id);
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["SUPPRESS", email.id]);
    Debug.devLog("INCREMENTING EMAIL_CAMPAIGN sentEmailCount: ", email.id);
    await query('UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1', [
      email.emailCampaignId,
    ]);
    Debug.devLog("ADDING SUPPRESS EVENT FOR EMAIL ID: ", email.id);
    await query(
      'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
      [email.id, "SUPPRESS", new Date().toISOString(), email.emailCampaignId],
    );
    console.log("Suppressed email " + email.id);
    return;
  }

  try {
    const emailSent = await sendSMTPEmail(
      {
        senderEmail: email.senderEmail,
        senderName: campaign.senderName,
        body: header + emailBodyHTML + footer,
        recipient: email.email,
        subject: emailSubject,
        replyToEmail: campaign.replyToEmail,
        campaignId: email.emailCampaignId,
        unsubscribeUrl: unsubscribeLink,
      },
      smtpCredentials,
    );

    if (emailSent && emailSent.accepted && emailSent.messageId) {
      Debug.devLog(
        "UPDATING STATUS FOR THE Email WITH MESSAGE_ID:",
        emailSent.messageId,
        "AND RECIPIENT:",
        email.email,
      );
      const updateEmailResult = query('UPDATE "Email" SET  status = $1, "messageId" = $2 WHERE id = $3', [
        "SENT",
        emailSent.messageId,
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

      await Promise.all([updateEmailResult, updateCampaignResult, updateOrganizationResult]);
    } else {
      console.error(
        "[SMTP_WORKER] Error While Sending Emails via Smtp for",
        email.email,
        emailSent ? emailSent.response : "",
      );
      throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by SMTP");
    }
  } catch (error) {
    smtpErrorHandler(error, job);
  }
}

const redisUrl = process.env.REDIS_URL;
const worker = new Worker(SMTP_EMAIL_QUEUE_KEY, (job) => handleJob(job), {
  concurrency: QUEUE_CONFIG.concurrency,
  connection: {
    url: redisUrl,
    retryStrategy: (attempts) => Math.min(attempts * 100, 3000),
  },
  lockDuration: 30000,
  lockRenewTime: 15000,
});

worker.on("failed", async (job) => {
  if (job && "id" in job.data.email) {
    console.log("Updating email status to ERROR");
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["ERROR", job.data.email.id]);
  } else {
    Debug.devLog("Failed to update email status to ERROR as there was not email id in the job data", job);
  }

  console.error("[SMTP_WORKER] Job failed");
});

worker.on("completed", () => {
  console.log("[SMTP_WORKER] Job completed");
});

worker.on("error", (error) => {
  Debug.devLog("[SMTP_WORKER] Error in SMTP worker", error);
});

worker.on("closing", () => {
  Debug.devLog("[SMTP_WORKER] SMTP worker is closing");
});

worker.on("ready", () => {
  console.log("[SMTP_WORKER] Worker is ready");
});

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing server...`);
  await worker.close();
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", function (err) {
  Debug.error(err, "Uncaught exception");
});
process.on("unhandledRejection", (reason, promise) => {
  Debug.error({ promise, reason }, "Unhandled Rejection at: Promise");
});
