import nodemailer, { SendMailOptions } from "nodemailer";
import { AppError } from "./errorHandler";
import { Attachment } from "nodemailer/lib/mailer";
import { htmlToText } from "html-to-text";

interface SendEmailSMTPParams {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  password: string;
  replyToEmail?: string;
  attachments?: Attachment[];
}

export async function sendEmailSMTP({
  senderEmail,
  senderName,
  recipient,
  subject,
  body,
  password,
  replyToEmail,
  attachments,
}: SendEmailSMTPParams) {
  try {
    if (!process.env.SMTP_HOST) {
      throw new AppError("INTERNAL_SERVER_ERROR", "SMTP_HOST is not set", false, "HIGH");
    }

    if (!senderEmail || !password) {
      throw new AppError("BAD_REQUEST", "Sender email or password is not provided");
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: {
        user: senderEmail,
        pass: password,
      },
    });

    // Prepare the email options
    const mailOptions = {
      from: `"${senderName}" <${senderEmail}>`,
      to: recipient,
      subject: subject,
      text: htmlToText(body, {
        wordwrap: 130,
      }),
      html: body,
      replyTo: replyToEmail || senderEmail,
      attachments: attachments || [],
    } satisfies SendMailOptions;

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
