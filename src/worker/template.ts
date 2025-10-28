import { TSubscriptionType } from "../lib/email";

export const getFooter = (subscriptionType: TSubscriptionType) => {
  const INCLUDE_SKYFUNNEL_BRANDING = ["FREE", "BASIC"];

  return `
            <div style="font-size:16px;padding:16px 24px 16px 24px; color: #737373;">
                <p style="text-align:center; padding: 0px 0px 16px 0px; font-size:14px;">
                ${INCLUDE_SKYFUNNEL_BRANDING.includes(subscriptionType) ? `<a href="https://skyfunnel.ai"><img src="https://app.skyfunnel.ai/images/full-logo.png" alt="SkyFunnel.ai" style="width: 100px;"/></a>` : " "}
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
