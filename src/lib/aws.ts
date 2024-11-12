import dotenv from "dotenv";
import { SendEmailCommand, SESClient, SESClientConfig } from "@aws-sdk/client-ses";
import { AppError } from "./errorHandler";
dotenv.config();

if (!process.env.S3_REGION) {
  throw new Error("S3_REGION is required");
}

if (!process.env.S3_ACCESS_KEY_ID) {
  throw new Error("S3_ACCESS_KEY_ID is required");
}

if (!process.env.S3_SECRET_ACCESS_KEY) {
  throw new Error("S3_SECRET_ACCESS_KEY is required");
}

if (!process.env.CONFIGURATION_SET) {
  throw new Error("CONFIGURATION_SET is required");
}

const sesClient: SESClient = new SESClient({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
} as SESClientConfig);

type Props = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
};
export async function sendEmailSES({ senderEmail, senderName, recipient, subject, body, replyToEmail }: Props) {
  if (!senderEmail || !senderName || !recipient || !subject || !body) {
    throw new AppError(
      "BAD_REQUEST",
      "Missing required parameters. Required parameters are senderEmail, senderName, recipient, subject, body",
    );
  }

  const sendEmailCommand = new SendEmailCommand({
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
          Data: body,
        },
        // Text: {
        // 	Charset: "UTF-8",
        // 	Data: "TEXT_FORMAT_BODY",
        // },
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

  try {
    const response = await sesClient.send(sendEmailCommand);
    return { success: true, message: response };
  } catch (e) {
    return { success: false, message: null, error: e };
  }
}
