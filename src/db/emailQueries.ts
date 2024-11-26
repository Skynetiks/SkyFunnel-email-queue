import { query } from "../lib/db";
import { decryptToken } from "../lib/decrypt";

export const getLeadById = async (leadId: string) => {
  const response = await query('SELECT * FROM "Lead" WHERE id = $1 AND "isSubscribedToEmail" = true', [leadId]);
  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

export const getUserById = async (userId: string) => {
  const response = await query('SELECT * FROM "User" WHERE id = $1', [userId]);
  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

export const getCampaignById = async (campaignId: string) => {
  const response = await query(
    'SELECT ec.*, ect.* FROM "EmailCampaign" ec JOIN "EmailCampaignTemplate" ect ON ec."emailCampaignTemplateId" = ect.id WHERE ec.id = $1;',
    [campaignId],
  );
  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

export const getSuppressedEmail = async (email: string) => {
  const response = await query('SELECT * FROM "BlacklistedEmail" WHERE email = $1', [email]);
  if (response.rows.length === 0) {
    return null;
  }

  return response.rows[0];
};

export const getSenderIdentity = async (senderEmail: string) => {
  const senderIdentity = await query('SELECT "password" FROM "SenderIdentities" WHERE "email"= $1', [senderEmail]);

  if (senderIdentity.rows.length === 0) {
    return null;
  }

  const { password: encryptedPassword } = senderIdentity.rows[0];

  return decryptToken(encryptedPassword);
};