import { Attachment } from "./admin-sendmail";

export interface Email {
    id: string;
    subject: string;
    bodyHTML: string;
    leadId: string;
    senderId: string;
    emailCampaignId: string;
    replyToEmail: string;
}
  
export interface CampaignOrg {
    id: string;
    name: string;
}
  

export const isEmail = (email: any): email is Email => {
  return (
    typeof email.id === 'string' &&
    typeof email.leadId === 'string' &&
    typeof email.emailCampaignId === 'string' &&
    typeof email.leadFirstName === 'string' &&
    typeof email.leadLastName === 'string' &&
    typeof email.leadEmail === 'string' &&
    typeof email.leadCompanyName === 'string' &&
    typeof email.emailCampaignId === 'string' &&
    typeof email.senderId === 'string'
  );
};

export const isCampaignOrg = (campaignOrg: any): campaignOrg is CampaignOrg => {
  return (
    typeof campaignOrg.id === 'string' &&
    typeof campaignOrg.name === 'string'
  );
};

export type EmailData = {
	to: string;
	subject: string;
	body: string;
	attachments: Attachment[];
};

export const isValidEmail = (email: any): email is EmailData => { 
	return (
		typeof email.to === 'string' &&
		typeof email.subject === 'string' &&
		typeof email.body === 'string'
	);
}
