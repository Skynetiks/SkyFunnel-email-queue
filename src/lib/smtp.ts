import nodemailer from "nodemailer";
import DKIM from "nodemailer/lib/dkim";
import { Attachment, Options } from "nodemailer/lib/mailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { v4 as uuidv4 } from "uuid";
import { convertHtmlToText } from "./utils";
import { AddSMTPRouteParamsType, SMTPCredentials } from "../server/types/smtpQueue";
import { decryptToken } from "./decrypt";
import { ErrorCodesToRetrySMTPEmailAfterOneDay } from "../config";
import { Job } from "bullmq";
import { smtpQueue } from "../server/emails";
import { AppError } from "./errorHandler";

export async function sendEmailSMTPAdmin(
  senderEmail: string,
  senderName: string,
  recipient: string,
  subject: string,
  body: string,
  replyToEmail?: string,
  attachments?: Attachment[],
) {
  try {
    if (!process.env.SMTP_HOST) {
      console.error("Missing SMTP_HOST");
    }
    if (!process.env.ADMIN_SMTP_EMAIL) {
      console.error("Missing ADMIN_SMTP_EMAIL");
    }
    if (!process.env.ADMIN_SMTP_PASS) {
      console.error("Missing ADMIN_SMTP_PASS");
    }
    if (!process.env.DKIM_PRIVATE_KEY) {
      console.error("Missing DKIM_PRIVATE_KEY");
    }

    // Generate a plain text alternative from the HTML body

    const plainTextBody = convertHtmlToText(body);
    const pkey = process.env.DKIM_PRIVATE_KEY;

    const dkim = {
      domainName: "skyfunnel.us",
      keySelector: "mail",
      privateKey: pkey,
    } as DKIM.Options;

    const messageId = uuidv4();
    const timestamp = Date.now();

    // Prepare the email options
    const mailOptions = {
      messageId: `<${messageId}-${timestamp}@skyfunnel.us>`,
      from: `${senderName} <${senderEmail}>`,
      sender: process.env.ADMIN_SMTP_EMAIL,
      to: recipient,
      subject: subject,
      text: plainTextBody,
      html: body,
      replyTo: replyToEmail || senderEmail,
      envelope: {
        from: `${messageId}-${timestamp}@skyfunnel.us`, // Custom MAIL FROM address
        to: recipient, // Envelope recipient
      },
      dkim: dkim,
      attachDataUrls: true,
      headers: {
        "Feedback-ID": `feedback-${messageId}`,
      },
      attachments: attachments,
    } satisfies Options;

    const info = await sendNodemailerEmailRaw(
      {
        host: process.env.SMTP_HOST!,
        port: 465,
        secure: true,
        user: process.env.ADMIN_SMTP_EMAIL!,
        pass: process.env.ADMIN_SMTP_PASS!,
      },
      mailOptions,
    );

    console.log("Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

type Credentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

async function sendNodemailerEmailRaw({ host, port, secure, user, pass }: Credentials, options: Options) {
  let transporter: nodemailer.Transporter | undefined;
  try {
    transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: secure,
      pool: true,
      auth: {
        user: user,
        pass: pass,
      },
      debug: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
      logger: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
    });
  
    const info = await transporter.sendMail(options);

    return info as SMTPTransport.SentMessageInfo;
  } finally {
    transporter?.close();
  }
}

type Email = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
};

export async function sendSMTPEmail(email: Email, smtpCredentials: SMTPCredentials) {
  const { body, senderEmail, senderName, recipient, subject, replyToEmail } = email;
  const plainTextBody = convertHtmlToText(body);

  // Prepare the email options
  const mailOptions = {
    from: `${senderName} <${senderEmail}>`,
    sender: process.env.ADMIN_SMTP_EMAIL,
    to: recipient,
    subject: subject,
    text: plainTextBody,
    html: body,
    replyTo: replyToEmail || senderEmail,
    attachDataUrls: true,
  } satisfies Options;

  const decryptedPass = decryptToken(smtpCredentials.encryptedPass)
  const info = await sendNodemailerEmailRaw(
    {
      host: smtpCredentials.host,
      port: smtpCredentials.port,
      secure: smtpCredentials.port === 465,
      user: smtpCredentials.user,
      pass: decryptedPass,
      pool: true,
    },
    mailOptions,
  );

  console.log("Email sent:", info.messageId);
  return info;
}


export async function smtpErrorHandler(error: unknown, job: Job<AddSMTPRouteParamsType>) {
  if (!(error instanceof Error && "responseCode" in error && typeof error.responseCode === "number")) throw error;

  const responseCode = error.responseCode;
  if(ErrorCodesToRetrySMTPEmailAfterOneDay.includes(responseCode)) {
    console.log("Error code " + responseCode + " detected. Delaying email sending for 1 day......");
    if(!job.data.campaignOrg.id) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Campaign organization id not found", false, "HIGH");
    }

    const ONE_DAY_IN_SECONDS = 86400;
    await smtpQueue.delayRemainingJobs(job.data.email.emailCampaignId, ONE_DAY_IN_SECONDS);
    return;
  }

  console.error("Fail to send email. Error code " + responseCode + " detected.", error);
  throw error;
}