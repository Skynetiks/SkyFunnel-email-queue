import { getFooter, getHeader } from "../worker/template";
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

  const emailBodyHTML = trackedEmailBodyHTML
    .replaceAll("[[firstname]]", data.leadFirstName)
    .replaceAll("[[lastname]]", data.leadLastName)
    .replaceAll("[[email]]", data.leadEmail)
    .replaceAll("[[companyname]]", data.leadCompanyName);

  const footer = getFooter(data.organizationName, data.leadId, data.subscriptionType);
  const header = getHeader(data.campaignId, data.emailId);

  return { emailBodyHTML, footer, header };
};

interface GetEmailSubjectParams {
  subject: string;
  leadFirstName: string;
  leadLastName: string;
  leadEmail: string;
  leadCompanyName: string;
}

export const getEmailSubject = (data: GetEmailSubjectParams) => {
  const emailSubject = data.subject
    .replaceAll("[[firstname]]", data.leadFirstName)
    .replaceAll("[[lastname]]", data.leadLastName)
    .replaceAll("[[email]]", data.leadEmail)
    .replaceAll("[[companyname]]", data.leadCompanyName);
  return emailSubject;
};
