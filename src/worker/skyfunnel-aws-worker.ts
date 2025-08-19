import { Job, Worker } from "bullmq";
import { QUEUE_CONFIG, SES_SKYFUNNEL_EMAIL_QUEUE_KEY } from "../config";
import { query } from "../lib/db";
import { AddSESEmailRouteParamsSchema, Email } from "../server/types/emailQueue";
import { AppError, errorHandler } from "../lib/errorHandler";
import { cache__getCampaignById, cache__getOrganizationSubscription, getSuppressedEmail } from "../db/emailQueries";
import { getEmailBody, getEmailSubject, getUnsubscribeLink, maskEmail } from "../lib/email";
import { sendEmailSES } from "../lib/aws";
import {
  Days,
  delayAllSkyfCampaignJobsTillNextValidTime,
  getNextActiveTime,
  isActiveDay,
  isWithinPeriod,
} from "../lib/utils";
import { usageRedisStore } from "../lib/usageRedisStore";
import { Debug } from "../lib/debug";
import { UnsubscribeTokenPayload } from "../lib/token";

const handleJob = async (job: Job) => {
  console.log("[SKYFUNNEL_WORKER] Job Started with jobID", job.id);
  const data = job.data;
  try {
    const validatedData = AddSESEmailRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      Debug.error("[EDGE_CASE] Validation failed for job data. This should not happen if job producer is correct.");
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
  // const lockKey = `lock:org:${campaignOrg.id}`;
  // let lock: Lock | null = null;

  try {
    // const redlock = await getRedLock();
    // lock = await redlock.acquire([lockKey], 5000);

    const campaignPromise = cache__getCampaignById(email.emailCampaignId, campaignOrg.id);
    const organizationSubscriptionPromise = cache__getOrganizationSubscription(campaignOrg.id);

    const [campaign, orgSubscription] = await Promise.all([campaignPromise, organizationSubscriptionPromise]);

    if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");
    if (!orgSubscription) throw new AppError("NOT_FOUND", "Organization not found");

    const isEmailsBlocked = orgSubscription.isEmailBlocked;
    if (isEmailsBlocked) {
      console.log("Emails are blocked for organization " + campaignOrg.id);
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

      await Promise.all([
        query('UPDATE "EmailCampaign" SET "status" = $1 WHERE id = $2', ["LIMIT", email.emailCampaignId]),
        query('UPDATE "Email" SET status = $1 WHERE id = $2', ["LIMIT", email.id]),
      ]);
      return;
    }
    const suppressedResults = await getSuppressedEmail(email.leadEmail);

    const { emailBodyHTML, header, hasUnsubscribeLink } = getEmailBody({
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

    const unsubscribeTokenPayload: UnsubscribeTokenPayload = {
      leadId: email.leadId,
      email: maskEmail(email.leadEmail),
      campaignId: email.emailCampaignId,
      reason: "User clicked the unsubscribe link/button in their email client",
      type: "unsubscribe",
    };

    const unsubscribeLink = getUnsubscribeLink(hasUnsubscribeLink, unsubscribeTokenPayload);

    const emailSent = await sendEmailSES({
      senderEmail: email.senderEmail,
      senderName: campaign.senderName,
      body: header + emailBodyHTML,
      recipient: email.leadEmail,
      subject: emailSubject,
      replyToEmail: campaign.replyToEmail,
      campaignId: email.emailCampaignId,
      unsubscribeUrl: unsubscribeLink,
    });

    if (emailSent && emailSent.success && !emailSent.message?.MessageId) {
      Debug.error(
        `[EDGE_CASE] SES response returned success but missing MessageId. Email ID: ${email.id}, ` +
          `Campaign ID: ${email.emailCampaignId}, Lead: ${email.leadEmail}`,
      );
    }

    if (emailSent && emailSent.success && emailSent.message?.MessageId) {
      const updateEmailResult = await query('UPDATE "Email" SET status = $1, "messageId" = $2 WHERE id = $3', [
        "SENT",
        emailSent.message.MessageId || "",
        email.id,
      ]);

      const updateCampaignResult = await query(
        'UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1',
        [email.emailCampaignId],
      );

      const updateOrganizationResult = await query(
        'UPDATE "Organization" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1',
        [campaignOrg.id],
      );

      await usageRedisStore.incrementUsage(organizationId);

      await Promise.all([updateEmailResult, updateCampaignResult, updateOrganizationResult]);
    } else {
      console.error("[SKYFUNNEL_WORKER] Error While Sending Emails via AWS", emailSent ? emailSent.error : "");
      throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by AWS");
    }
  } catch (error) {
    console.error("[SKYFUNNEL_WORKER] Error While Sending Emails via AWS", error);
    throw error;
  }
  // finally {
  //   // if (lock) await lock.release().catch((err) => console.error("[EDGE_CASE] Error while releasing lock", err));
  // }
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
  Debug.error(`[EDGE_CASE] Email Failed but don't have emailId In it, ${JSON.stringify(job?.data)} `);
  if (job && "id" in job.data.email) {
    console.log("Updating status to ERROR for email with id " + job.data.email.id);
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
