import { QueryResult } from "pg";
import { cache, deleteCache } from "../lib/cache";
import { query } from "../lib/db";
import { usageRedisStore } from "../lib/usageRedisStore";

export const getOrganizationById = async (organizationId: string) => {
  const response = await query('SELECT * FROM "Organization" WHERE id = $1', [organizationId]);
  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

type OrganizationSubscription = {
  id: string;
  allowedEmails: number;
  leadManagementModuleType: "PRO" | "FREE" | "BASIC" | "CUSTOM";
  isEmailBlocked: boolean;
};

export const getOrganizationSubscription = async (organizationId: string) => {
  const response = (await query(
    `SELECT
             subscription.id,
             subscription."allowedEmails",
             subscription."leadManagementModuleType",
             org."isEmailBlocked"
          FROM "OrgSubscription" subscription
          INNER JOIN "Organization" org
          ON org."orgSubscriptionId" = subscription.id
          WHERE org.id = $1`,
    [organizationId],
  )) as QueryResult<OrganizationSubscription>;

  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

const ONE_DAY = 86400;

export const cache__getOrganizationSubscription = async (organizationId: string, ttl = ONE_DAY) => {
  return await cache(
    `organizationSubscription:${organizationId}`,
    async () => {
      return await getOrganizationSubscription(organizationId);
    },
    ttl,
  );
};

type EmailCampaign = {
  id: string;
  campaignContentType: "TEXT" | "TEMPLATE";
  plainTextBody: string;
  bodyHTML: string;
  senderEmail: string;
  senderName: string;
  replyToEmail: string;
  subject: string;
};
export const getCampaignById = async (campaignId: string) => {
  const response = (await query(
    `SELECT
            ec.id,
            ec."campaignContentType",
            ec."plainTextBody",
            ect."bodyHTML",
            ec."senderName",
            ec.subject,
            ec."replyToEmail"
        FROM "EmailCampaign" ec
        LEFT JOIN "EmailCampaignTemplate" ect
        ON ec."emailCampaignTemplateId" = ect.id
        WHERE ec.id = $1;`,
    [campaignId],
  )) as QueryResult<EmailCampaign>;
  if (response.rows.length === 0) {
    return null;
  }
  return response.rows[0];
};

export const cache__getCampaignById = async (campaignId: string, ttl = ONE_DAY) => {
  return await cache(
    `campaign:${campaignId}`,
    async () => {
      return await getCampaignById(campaignId);
    },
    ttl,
  );
};

export const getSuppressedEmail = async (email: string) => {
  const response = await query('SELECT * FROM "BlacklistedEmail" WHERE email = $1', [email]);
  if (response.rows.length === 0) {
    return null;
  }

  return response.rows[0];
};

export const clearOrgCache = async (organizationId: string) => {
  await deleteCache(`organizationSubscription:${organizationId}`);
  await deleteCache(`campaign:${organizationId}`);
  await usageRedisStore.revalidateUsage(organizationId);
};
