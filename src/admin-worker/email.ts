import { ADMIN_WORKER_QUEUE_CONFIG } from "../config";
import { AppError, errorHandler } from "../lib/errorHandler";
import { sendEmailSMTP } from "../lib/smtp";
import { AdminWorkerEmailSchema } from "./types/email";

export const handleJob = async (data: unknown) => {
  try {
    const { data: email, success, error } = AdminWorkerEmailSchema.safeParse(data);

    if (!success) {
      throw new AppError("BAD_REQUEST", error.errors[0].message);
    }

    if (!process.env.ADMIN_SENDER_PASSWORD) {
      throw new AppError("INTERNAL_SERVER_ERROR", "ADMIN_SENDER_PASSWORD is not set", false, "HIGH");
    }

    const sentEmail = await sendEmailSMTP({
      senderEmail: ADMIN_WORKER_QUEUE_CONFIG.senderEmail,
      senderName: ADMIN_WORKER_QUEUE_CONFIG.senderName,
      recipient: email.to,
      subject: email.subject,
      body: email.body,
      replyToEmail: ADMIN_WORKER_QUEUE_CONFIG.replyToEmail,
      attachments: email.attachments,
    });

    if (!sentEmail.accepted && !sentEmail.messageId) {
      console.error("Error sending email:", sentEmail.response);
      throw new AppError("INTERNAL_SERVER_ERROR", "Email not sent by SMTP");
    } else {
      console.log("Email sent:", sentEmail.messageId);
    }
  } catch (error) {
    console.error(error);
    errorHandler(error, true);
  }
};
