import { getFooter, getHeader } from "../worker/template";
import { generateUnsubscribeToken, UnsubscribeTokenPayload } from "./token";
import { replaceUrlsInEmailHtml } from "./utils";

export type TSubscriptionType = "FREE" | "BASIC" | "PRO" | "CUSTOM";

type Params = {
  campaignId: string;
  rawBodyHTML: string;
  emailId: string;
  leadFirstName: string;
  leadLastName: string;
  leadEmail: string;
  leadCompanyName: string;
  leadId: string;
  subscriptionType: TSubscriptionType;
  organizationName: string;
  leadDoubleOptInToken: string;
};

export const getEmailBody = (data: Params) => {
  const trackedEmailBodyHTML = replaceUrlsInEmailHtml(
    { id: data.campaignId, bodyHTML: data.rawBodyHTML },
    data.emailId,
  );

  const unsubscribeKey = `unsubscribe_link`;
  const doubleOptInKey = `doubleoptin_link`;
  const hasUnsubscribeLink = data.rawBodyHTML.includes(unsubscribeKey);

  const emailBodyHTML = trackedEmailBodyHTML.replace(/\[\[(\w+)(?:\s*\|\|\s*(.+?))?\]\]/g, (match, key, fallback) => {
    switch (key.toLowerCase()) {
      case "firstname":
        return data.leadFirstName || fallback || "";
      case "lastname":
        return data.leadLastName || fallback || "";
      case "email":
        return data.leadEmail || fallback || "";
      case "companyname":
        return data.leadCompanyName || fallback || "";
      case doubleOptInKey:
        return `${process.env.MAIN_APP_BASE_URL}/api/double-opt-in/confirm?token=${data.leadDoubleOptInToken}`;
      case unsubscribeKey:
        return `${process.env.MAIN_APP_BASE_URL}/unsubscribe/${data.leadId}`;
      default:
        return fallback || "";
    }
  });

  const footer = getFooter(data.organizationName, data.leadId, data.subscriptionType);
  const header = getHeader(data.campaignId, data.emailId);

  return { emailBodyHTML, header, hasUnsubscribeLink, footer };
};

interface GetEmailSubjectParams {
  subject: string;
  leadFirstName: string;
  leadLastName: string;
  leadEmail: string;
  leadCompanyName: string;
}

export const getEmailSubject = (data: GetEmailSubjectParams) => {
  const emailSubject = data.subject.replace(/\[\[(\w+)(?:\s*\|\|\s*(.+?))?\]\]/g, (match, key, fallback) => {
    switch (key.toLowerCase()) {
      case "firstname":
        return data.leadFirstName || fallback || "";
      case "lastname":
        return data.leadLastName || fallback || "";
      case "email":
        return data.leadEmail || fallback || "";
      case "companyname":
        return data.leadCompanyName || fallback || "";
      default:
        return fallback || "";
    }
  });

  return emailSubject;
};

export const getUnsubscribeLink = (hasUnsubscribeLink: boolean, data: UnsubscribeTokenPayload) => {
  if (!hasUnsubscribeLink) return undefined;
  const EXPIRES_IN_HOURS = 8 * 24; // 8 days
  const token = generateUnsubscribeToken(data, EXPIRES_IN_HOURS);
  return `${process.env.MAIN_APP_BASE_URL}/api/unsubscribe?token=${token}`;
};

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `*@${domain}`;
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}
