import { QueryResult } from "pg";
import { cache, deleteCache } from "../lib/cache";
import { query } from "../lib/db";
import { usageRedisStore } from "../lib/usageRedisStore";

const __getSubscriptionCacheKey = (organizationId: string): string => `organizationSubscription:${organizationId}`;

const __getCampaignCacheKey = (campaignId: string, organizationId: string): string =>
  `campaign:${organizationId}:${campaignId}`;

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

const HALF_DAY = 43200;

export const cache__getOrganizationSubscription = async (organizationId: string, ttl = HALF_DAY) => {
  return await cache(
    __getSubscriptionCacheKey(organizationId),
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

export const cache__getCampaignById = async (campaignId: string, organizationId: string, ttl = HALF_DAY) => {
  return await cache(
    __getCampaignCacheKey(campaignId, organizationId),
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

export enum CACHE_CLEAR_TYPE {
  SUBSCRIPTION = "SUBSCRIPTION",
  CAMPAIGN = "CAMPAIGN",
  ALL = "ALL",
}

export const clearCache = async <T extends CACHE_CLEAR_TYPE>(
  type: T,
  options: T extends CACHE_CLEAR_TYPE.CAMPAIGN
    ? { campaignId: string; organizationId: string }
    : { organizationId: string; campaignId: undefined },
) => {
  if (!("organizationId" in options) || !options.organizationId) {
    throw new Error("Organization Id must be provided to clear cache");
  }

  switch (type) {
    case CACHE_CLEAR_TYPE.SUBSCRIPTION: {
      const { organizationId } = options;
      await deleteCache(__getSubscriptionCacheKey(organizationId));
      await usageRedisStore.revalidateUsage(organizationId);
      break;
    }

    case CACHE_CLEAR_TYPE.CAMPAIGN: {
      if (!options.campaignId) {
        throw new Error("Invalid data passed in type campaign campaign id is required");
      }

      const { campaignId, organizationId } = options;
      await deleteCache(__getCampaignCacheKey(campaignId, organizationId));
      break;
    }

    case CACHE_CLEAR_TYPE.ALL: {
      const { organizationId } = options;
      await deleteCache(__getSubscriptionCacheKey(organizationId));
      await deleteCache(__getCampaignCacheKey("*", organizationId));
      await usageRedisStore.revalidateUsage(organizationId);
      break;
    }

    default:
      throw new Error("Invalid cache clear type");
  }
};
