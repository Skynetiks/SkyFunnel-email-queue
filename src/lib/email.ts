import { getHeader } from "../worker/template";
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
};

export const getEmailBody = (data: Params) => {
  const trackedEmailBodyHTML = replaceUrlsInEmailHtml(
    { id: data.campaignId, bodyHTML: data.rawBodyHTML },
    data.emailId,
  );

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
      case "unsubscribe_link":
        return `${process.env.MAIN_APP_BASE_URL}unsubscribe/${data.leadId}`;
      default:
        return fallback || "";
    }
  });

  //   const footer = getFooter(data.organizationName, data.leadId, data.subscriptionType);
  const header = getHeader(data.campaignId, data.emailId);

  return { emailBodyHTML, header };
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
