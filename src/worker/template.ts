export const getFooter = (organizationName: string, leadId: string) => {
    return `
            <div style="font-size:16px;padding:16px 24px 16px 24px; color: #737373; background-color: #F5F5F5">
                <p style="text-align:center; font-size:12px">
                    Copyright (C) ${new Date().getFullYear()} ${organizationName}. All rights reserved.
                </p>
                <p style="text-align:center; font-size:12px">
                    Do not want to receive these mails? Click
                    <a href="${process.env.MAIN_APP_BASE_URL}unsubscribe/${leadId}" style="text-decoration: underline">here</a> to
                    unsubscribe.
                </p>
                <p style="text-align:center; padding: 0px 0px 16px 0px; font-size:14px;">
                    <a href="https://skyfunnel.ai/" style="text-decoration: underline">SkyFunnel.ai</a>
                </p>
            </div>
      `;
  };
  
  export const getHeader = (campaignId: string, emailId: string) => {
    return `
    <div>
    <img src="${process.env.MAIN_APP_BASE_URL}/api/email-track-open?campaignId=${campaignId}&emailId=${emailId}" alt="" style="display: none;" width="1" height="1" />
    </div>`;
  };
  