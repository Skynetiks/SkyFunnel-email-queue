import { getCampaignById, getLeadById, getSuppressedEmail, getUserById } from "../db/emailQueries";
import { query } from "../lib/db";
import { AppError } from "../lib/errorHandler";
import { sendEmailSMTP } from "../lib/smtp";
import { replaceUrlsInEmailHtml } from "../lib/utils";
import { Email } from "../server/types/emailQueue";
import { getFooter, getHeader } from "./template";

export const sendEmailAndUpdateStatus = async (email: Email, campaignOrg: { name: string; id: string }) => {
  const leadResultsPromise = getLeadById(email.leadId);
  const userResultsPromise = getUserById(email.senderId);
  const campaignPromise = getCampaignById(email.emailCampaignId);

  const [lead, user, campaign] = await Promise.all([leadResultsPromise, userResultsPromise, campaignPromise]);

  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found");
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found");

  const suppressedResults = await getSuppressedEmail(lead.email);

  const trackedEmailBodyHTML = replaceUrlsInEmailHtml(
    { id: email.emailCampaignId, bodyHTML: campaign.bodyHTML },
    email.id,
  );
  const emailBodyHTML = trackedEmailBodyHTML
    .replaceAll("[[firstname]]", email.leadFirstName || "")
    .replaceAll("[[lastname]]", email.leadLastName || "")
    .replaceAll("[[email]]", email.leadEmail || "")
    .replaceAll("[[companyname]]", email.leadCompanyName || "");

  const footer = getFooter(campaignOrg.name, lead.id);
  const header = getHeader(email.emailCampaignId, email.id);

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

  const emailSent = await sendEmailSMTP({
    senderEmail: campaign.senderEmail,
    senderName: campaign.senderName,
    body: header + emailBodyHTML + footer,
    recipient: lead.email,
    subject: campaign.subject,
    replyToEmail: campaign.replyToEmail,
  });

  if (emailSent.accepted && emailSent.messageId) {
    const updateEmailResult = query('UPDATE "Email" SET status = $1, "awsMessageId" = $2 WHERE id = $3', [
      "SENT",
      emailSent.messageId || "",
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
    console.error("Error While Sending Emails via AWS", emailSent.response);
    throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by AWS");
  }
};
