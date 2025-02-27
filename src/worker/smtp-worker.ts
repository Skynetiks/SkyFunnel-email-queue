import { smtpQueue } from "./../server/emails";
import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SMTP_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AppError, errorHandler } from "../lib/errorHandler";
import {
  getCampaignById,
  getLeadById,
  getOrganizationById,
  getOrganizationSubscription,
  getSuppressedEmail,
  getUserById,
} from "../db/emailQueries";
import { getEmailBody } from "../lib/email";
import { Debug, generateJobId, getDelayedJobId, isWithinPeriod } from "../lib/utils";
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
    const isWithinPeriodValue = isWithinPeriod(email.startTimeInUTC, email.endTimeInUTC);
    Debug.devLog(isPaused ? "[SMTP_WORKER] Campaign is paused" : "[SMTP_WORKER] Campaign is not paused");
    if (isPaused || !isWithinPeriodValue) {
      // TODO: calculate delay time based on the next start time
      const DELAY_TIME = 1000 * QUEUE_CONFIG.delayAfterPauseInSeconds;

      if (!isWithinPeriodValue) Debug.devLog("[SMTP_WORKER] Delaying the campaign because it is not within the period");

      try {
        const queue = smtpQueue.getQueue();
        const newJobId = getDelayedJobId(job.id || generateJobId(email.emailCampaignId, email.id, "SMTP"));
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

  const organizationId = user.organizationId;
  const organization = await getOrganizationById(organizationId);

  const organizationSubscription = await getOrganizationSubscription(organization.orgSubscriptionId);

  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");

  const suppressedResults = await getSuppressedEmail(lead.email);

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
    subscriptionType: organizationSubscription.leadManagementModuleType,
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
      Debug.devLog(
        "UPDATING STATUS FOR THE Email WITH MESSAGE_ID:",
        emailSent.messageId,
        "AND RECIPIENT:",
        email.leadEmail,
      );
      const updateEmailResult = query('UPDATE "Email" SET status = $1, "messageId" = $2 WHERE id = $3', [
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

      const addDeliveryEventResult = query(
        'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
        [email.id, "DELIVERY", new Date().toISOString(), email.emailCampaignId],
      );

      await Promise.all([updateEmailResult, updateCampaignResult, addDeliveryEventResult, updateOrganizationResult]);
    } else {
      console.error(
        "[SMTP_WORKER] Error While Sending Emails via Smtp for",
        email.leadEmail,
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
