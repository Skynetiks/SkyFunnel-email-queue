import dotenv from "dotenv";
import { SendEmailCommand, SESClient, SESClientConfig } from "@aws-sdk/client-ses";
import { AppError } from "./errorHandler";
import { Debug } from "./utils";
dotenv.config();

if (!process.env.SES_REGION) {
  throw new Error("SES_REGION is required");
}

if (!process.env.SES_ACCESS_KEY) {
  throw new Error("SES_ACCESS_KEY is required");
}

if (!process.env.SES_SECRET_KEY) {
  throw new Error("SES_SECRET_KEY is required");
}

if (!process.env.CONFIGURATION_SET) {
  throw new Error("CONFIGURATION_SET is required");
}

const sesClient: SESClient = new SESClient({
  region: process.env.SES_REGION,
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY,
    secretAccessKey: process.env.SES_SECRET_KEY,
  },
} as SESClientConfig);

type Props = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
  campaignId?: string;
};

const getSendEmailCommand = (
  senderEmail: string,
  senderName: string,
  recipient: string,
  subject: string,
  body: string,
  replyToEmail?: string,
  campaignId?: string,
) => {
  const bodyWithCampaignId = campaignId ? `${body} thread::${campaignId}` : body;
  const campaignIdHtml = campaignId ? `<p style='display:none'>thread::${campaignId}</p>` : "";
  const bodyWithCampaignIdHtml = `${body} ${campaignIdHtml}`;
  return new SendEmailCommand({
    Destination: {
      /* required */
      CcAddresses: [
        /* more items */
      ],
      ToAddresses: [
        /* more To-email addresses */
        // recipient,
        recipient,
      ],
    },
    Message: {
      /* required */
      Body: {
        /* required */
        Html: {
          Charset: "UTF-8",
          Data: bodyWithCampaignIdHtml,
        },
        Text: {
          Charset: "UTF-8",
          Data: bodyWithCampaignId,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: `${senderName} <${senderEmail}>`,
    ReplyToAddresses: [
      /* more items */
      replyToEmail || senderEmail,
    ],
    ...(process.env.CONFIGURATION_SET
      ? {
          ConfigurationSetName: process.env.CONFIGURATION_SET,
        }
      : {}),
  });
};

export async function sendEmailSES({
  senderEmail,
  senderName,
  recipient,
  subject,
  body,
  replyToEmail,
  campaignId,
}: Props) {
  if (!senderEmail || !senderName || !recipient || !subject || !body) {
    throw new AppError(
      "BAD_REQUEST",
      "Missing required parameters. Required parameters are senderEmail, senderName, recipient, subject, body",
    );
  }

  const sendEmailCommand = getSendEmailCommand(
    senderEmail,
    senderName,
    recipient,
    subject,
    body,
    replyToEmail,
    campaignId,
  );

  try {
    const response = await sesClient.send(sendEmailCommand);
    return { success: true, message: response };
  } catch (e) {
    return { success: false, message: null, error: e };
  }
}

export async function sendEmailSESWithCredentials({
  senderEmail,
  senderName,
  recipient,
  subject,
  body,
  replyToEmail,
  credentials,
}: Props & { credentials: { accessKeyId: string; secretAccessKey: string; region: string } }) {
  if (!senderEmail || !senderName || !recipient || !subject || !body) {
    throw new Error(
      "Missing required parameters. Required parameters are senderEmail, senderName, recipient, subject, body",
    );
  }

  const sendEmailCommand = getSendEmailCommand(senderEmail, senderName, recipient, subject, body, replyToEmail);

  try {
    const sesClient = new SESClient({
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    });
    const response = await sesClient.send(sendEmailCommand);
    return { success: true, message: response };
  } catch (e) {
    Debug.error(e);
    return { success: false, message: null, error: e };
  }
}
