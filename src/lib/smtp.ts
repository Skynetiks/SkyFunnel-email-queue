import nodemailer from "nodemailer";
import { AppError } from "./errorHandler";
import { Attachment } from "nodemailer/lib/mailer";
import { htmlToText } from "html-to-text";
import DKIM from "nodemailer/lib/dkim";
import { Options } from "nodemailer/lib/mailer";
import { v4 as uuidv4 } from "uuid";

interface SendEmailSMTPParams {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
  attachments?: Attachment[];
}

export async function sendEmailSMTP({
  senderEmail,
  senderName,
  recipient,
  subject,
  body,
  replyToEmail,
  attachments,
}: SendEmailSMTPParams) {
  try {
    if (!process.env.SMTP_HOST) {
      throw new AppError("INTERNAL_SERVER_ERROR", "SMTP_HOST is not set", false, "HIGH");
    }
    if (!process.env.ADMIN_SMTP_EMAIL) {
      throw new AppError("BAD_REQUEST", "ADMIN_SMTP_EMAIL is not provided");
    }
    if (!process.env.ADMIN_SMTP_PASS) {
      throw new AppError("BAD_REQUEST", "ADMIN_SMTP_PASS is not provided");
    }
    if (!process.env.DKIM_PRIVATE_KEY) {
      throw new AppError("BAD_REQUEST", "DKIM_PRIVATE_KEY is not provided");
    }
    if (!senderEmail) {
      throw new AppError("BAD_REQUEST", "Sender email not provided");
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: {
        user: process.env.ADMIN_SMTP_EMAIL,
        pass: process.env.ADMIN_SMTP_PASS,
      },
    });

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
      text: htmlToText(body, {
        wordwrap: 130,
      }),
      html: body,
      replyTo: replyToEmail || senderEmail,
      envelope: {
        from: `${messageId}-${timestamp}@skyfunnel.us`, // Custom MAIL FROM address
        to: recipient, // Envelope recipient
      },
      dkim: dkim,
      attachDataUrls: true,
      attachments: attachments || [],
      headers: {
        "Feedback-ID": `feedback-${messageId}`,
      },
    } as Options;

    const info = await transporter.sendMail(mailOptions);
    transporter.close();

    console.log("Email sent:", info.messageId);

    if (!info) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by SMTP");
    }

    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    if (error instanceof AppError) throw error;
    if (error instanceof Error) throw new AppError("INTERNAL_SERVER_ERROR", error.message);
    throw new AppError("INTERNAL_SERVER_ERROR", "Error sending email");
  }
}
