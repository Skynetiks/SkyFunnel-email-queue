import dotenv from "dotenv";
import { SendEmailCommand, SESv2Client, SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { AppError } from "./errorHandler";
import { Debug } from "./debug";
import { createTransport } from "nodemailer";
import { MailOptions } from "nodemailer/lib/stream-transport";

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

if (!process.env.CONFIGURATION_SET && process.env.NODE_ENV !== "development") {
  throw new Error("CONFIGURATION_SET is required");
}

const sesClient: SESv2Client = new SESv2Client({
  region: process.env.SES_REGION,
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY,
    secretAccessKey: process.env.SES_SECRET_KEY,
  },
} as SESv2ClientConfig);

const getHeaders = ({
  campaignId,
  unsubscribeUrl,
}: {
  campaignId?: string;
  unsubscribeUrl?: string;
}): Record<string, string> => {
  const headers = [];

  if (campaignId) {
    headers.push({
      Name: "X-Campaign-Id",
      Value: campaignId,
    });
  }

  if (unsubscribeUrl) {
    headers.push({
      Name: "List-Unsubscribe",
      Value: `<${unsubscribeUrl}>`,
    });

    headers.push({
      Name: "List-Unsubscribe-Post",
      Value: "List-Unsubscribe=One-Click",
    });
  }

  return headers.reduce(
    (acc, header) => {
      acc[header.Name] = header.Value;
      return acc;
    },
    {} as Record<string, string>,
  );
};

const getRawEmail = async ({
  to,
  from,
  subject,
  html,
  text,
  replyTo,
  unsubscribeUrl,
  campaignId,
}: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  unsubscribeUrl?: string;
  campaignId?: string;
}) => {
  const campaignIdHtml = campaignId ? `<p style='display:none'>thread::${campaignId}</p>` : "";
  const bodyWithCampaignIdHtml = `${html} ${campaignIdHtml}`;
  const bodyWithCampaignId = `${text} ${campaignIdHtml}`;

  const headers = getHeaders({ campaignId, unsubscribeUrl });

  const nodemailerTransport = createTransport({
    streamTransport: true,
    newline: "unix",
    buffer: true,
  });

  const message = {
    from,
    to,
    subject,
    text: bodyWithCampaignId,
    html: bodyWithCampaignIdHtml,
    replyTo: replyTo || from,
    headers,
  } satisfies MailOptions;

  const rawEmail = await new Promise<Buffer>((resolve, reject) => {
    nodemailerTransport.sendMail(message, (err, info) => {
      if (err) return reject(err);
      resolve(info.message as Buffer);
    });
  });

  return rawEmail;
};

const getSendEmailCommand = async (
  senderEmail: string,
  senderName: string,
  recipient: string,
  subject: string,
  body: string,
  replyToEmail?: string,
  campaignId?: string,
  unsubscribeUrl?: string,
) => {
  const rawEmail = await getRawEmail({
    to: recipient,
    from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
    subject,
    html: body,
    text: body,
    campaignId: campaignId,
    replyTo: replyToEmail || senderEmail,
    unsubscribeUrl,
  });

  return new SendEmailCommand({
    Content: {
      Raw: {
        Data: rawEmail,
      },
    },
    ...(process.env.CONFIGURATION_SET
      ? {
          ConfigurationSetName: process.env.CONFIGURATION_SET,
        }
      : {}),
  });
};

type Props = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
  campaignId?: string;
  unsubscribeUrl?: string;
};

export async function sendEmailSES({
  senderEmail,
  senderName,
  recipient,
  subject,
  body,
  replyToEmail,
  campaignId,
  unsubscribeUrl,
}: Props) {
  if (!senderEmail || !senderName || !recipient || !subject || !body) {
    throw new AppError(
      "BAD_REQUEST",
      "Missing required parameters. Required parameters are senderEmail, senderName, recipient, subject, body",
    );
  }

  const sendEmailCommand = await getSendEmailCommand(
    senderEmail,
    senderName,
    recipient,
    subject,
    body,
    replyToEmail,
    campaignId,
    unsubscribeUrl,
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

  const sendEmailCommand = await getSendEmailCommand(senderEmail, senderName, recipient, subject, body, replyToEmail);

  try {
    const sesClient = new SESv2Client({
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
