import {
  SendRawEmailCommand,
  SESClient,
  SESClientConfig,
} from "@aws-sdk/client-ses";

import { EmailData } from "./types";

require("dotenv").config()

if(!process.env.S3_REGION ){
	throw new Error("S3_REGION is required");
}

if(!process.env.S3_ACCESS_KEY_ID ){
    throw new Error("S3_ACCESS_KEY_ID is required");
}

if(!process.env.S3_SECRET_ACCESS_KEY ){
    throw new Error("S3_SECRET_ACCESS_KEY is required");
}

export type Attachment = {
  filename: string;
  content: string; 
};

const sesClient: SESClient = new SESClient({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
} as SESClientConfig);

function buildRawEmail(
  sender: string,
  recipient: string,
  subject: string,
  body: string,
  attachments?: Attachment[],
  replyToEmail?: string
) {
  const boundary = "b1-lksdjfj3ljlkj3lk43nlknlkjdslkjf2";
  let rawEmail = `From: ${sender}\n`;
  rawEmail += `To: ${recipient}\n`;
  rawEmail += `Subject: ${subject}\n`;
  rawEmail += `MIME-Version: 1.0\n`;
  rawEmail += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;

  if (replyToEmail) {
    rawEmail += `Reply-To: ${replyToEmail}\n`;
  }

  rawEmail += `--${boundary}\n`;
  rawEmail += `Content-Type: text/html; charset=UTF-8\n`;
  rawEmail += `Content-Transfer-Encoding: 7bit\n\n`;
  rawEmail += `${body}\n\n`;

  if (attachments) {
    for (const attachment of attachments) {
      const attachmentBuffer = Buffer.from(attachment.content, "base64");
      const contentType = "application/octet-stream";
      rawEmail += `--${boundary}\n`;
      rawEmail += `Content-Type: ${contentType}; name="${attachment.filename}"\n`;
      rawEmail += `Content-Disposition: attachment; filename="${attachment.filename}"\n`;
      rawEmail += `Content-Transfer-Encoding: base64\n\n`;
      rawEmail += `${attachment.content}\n\n`;
    }
  }

  rawEmail += `--${boundary}--`;

  return rawEmail;
}

export async function sendEmailSES(
  sender: string,
  senderName: string,
  recipient: string,
  subject: string,
  body: string,
  attachments?: Attachment[],
  replyToEmail?: string
) {
  const rawEmail = buildRawEmail(
    `${senderName} <${sender}>`,
    recipient,
    subject,
    body,
    attachments,
    replyToEmail
  );

  const sendRawEmailCommand = new SendRawEmailCommand({
    RawMessage: { Data: new Uint8Array(Buffer.from(rawEmail)) },
    Source: `${senderName} <${sender}>`,
    Destinations: [recipient],
    ConfigurationSetName: "engagement-tracking",
  });

  try {
    const response = await sesClient.send(sendRawEmailCommand);
    return { success: true, message: response, messageId: response.MessageId };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export const handleJob = async (email: EmailData) => {
	try {
		const { to, subject, body, attachments } = email;

		const sentEmail = await sendEmailSES(
			"noreply@skyfunnel.ai",
			"SkyFunnel.ai",
			to,
			subject,
			body,
			attachments,
		);

		console.log(sentEmail);
	} catch (error) {
		console.error(error);
		throw error
	}
};

