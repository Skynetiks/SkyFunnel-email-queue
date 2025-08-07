import nodemailer from "nodemailer";
import DKIM from "nodemailer/lib/dkim";
import { Attachment, Options } from "nodemailer/lib/mailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { v4 as uuidv4 } from "uuid";
import { convertHtmlToText } from "./utils";
import { Debug } from "./debug";
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

class NodemailerTransporter {
  private transporters: Map<string, { transporter: nodemailer.Transporter; lastUsed: number }>;
  private static instance: NodemailerTransporter | null = null;
  private cleanupInterval: NodeJS.Timeout | null;

  private static cleanUpAfterMs = 5 * 60 * 1000; // 5 minutes
  private static cleanUpCheckIntervalMs = 60 * 1000; // 1 minute

  constructor() {
    this.transporters = new Map();
    this.cleanupInterval = null;
    this.startCleanup();
  }

  static getInstance(): NodemailerTransporter {
    if (!this.instance) {
      this.instance = new NodemailerTransporter();
    }
    return this.instance;
  }

  private generateKey({ host, user }: { host: string; user: string }) {
    return `${host}_${user}`; // Composite key using host and user
  }

  getOrCreateTransporter({ host, port, secure, user, pass }: Credentials) {
    const key = this.generateKey({ host, user });

    if (this.transporters.has(key)) {
      // Update lastUsed timestamp and return existing transporter
      const entry = this.transporters.get(key)!;
      entry.lastUsed = Date.now();
      return entry.transporter;
    }

    try {
      // Create a new transporter
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        pool: true,
        auth: { user, pass },
        debug: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
        logger: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
        maxConnections: 5, // Limit connections
        maxMessages: 100,
      });

      this.transporters.set(key, { transporter, lastUsed: Date.now() });
      return transporter;
    } catch (error) {
      Debug.error(`Failed to create transporter for ${key}:`, error);
      throw error;
    }
  }

  getTransporter({ host, user }: { host: string; user: string }) {
    const key = this.generateKey({ host, user });
    const entry = this.transporters.get(key);
    if (entry) {
      entry.lastUsed = Date.now(); // Update lastUsed timestamp
      return entry.transporter;
    }
    return null;
  }

  closeTransporter({ host, user }: { host: string; user: string }) {
    const key = this.generateKey({ host, user });
    const entry = this.transporters.get(key);

    if (entry) {
      try {
        entry.transporter.close();
        this.transporters.delete(key);
      } catch (error) {
        Debug.error(`Failed to close transporter for ${key}:`, error);
      }
    }
  }

  private isTransporterInactive(lastUsed: number) {
    const idleTimeout = NodemailerTransporter.cleanUpAfterMs;
    return Date.now() - lastUsed > idleTimeout;
  }

  private startCleanup() {
    this.cleanupInterval = setInterval(() => {
      for (const [key, { transporter, lastUsed }] of this.transporters.entries()) {
        try {
          if (this.isTransporterInactive(lastUsed)) {
            transporter.close();
            this.transporters.delete(key);
            console.log(`Cleaned up inactive transporter: ${key}`);
          }
        } catch (error) {
          console.error(`Error cleaning up transporter ${key}:`, error);
        }
      }
    }, NodemailerTransporter.cleanUpCheckIntervalMs);
  }

  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = Array.from(this.transporters.entries()).map(async ([key, { transporter }]) => {
      try {
        await transporter.close();
        this.transporters.delete(key);
      } catch (error) {
        Debug.error(`Failed to close transporter for ${key}:`, error);
      }
    });

    await Promise.all(closePromises);
  }
}

async function sendNodemailerEmailRaw({ host, port, secure, user, pass }: Credentials, options: Options) {
  const instance = NodemailerTransporter.getInstance();

  const transporter = instance.getOrCreateTransporter({ host, port, secure, user, pass });
  if (!transporter) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Failed to create transporter");
  }

  try {
    const info = await transporter.sendMail(options);
    return info as SMTPTransport.SentMessageInfo;
  } finally {
    instance?.closeTransporter({ host, user });
  }
}

type Email = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  body: string;
  replyToEmail?: string;
  campaignId?: string;
};

export async function sendSMTPEmail(email: Email, smtpCredentials: SMTPCredentials) {
  const { body, senderEmail, senderName, recipient, subject, replyToEmail, campaignId } = email;
  const plainTextBody = convertHtmlToText(body);
  const campaignIdHtml = campaignId ? `<p style='display:none'>thread::${campaignId}</p>` : "";
  const plainTextBodyWithCampaignId = campaignId ? `${plainTextBody} thread::${campaignId}` : plainTextBody;
  const html = `${body} ${campaignIdHtml}`;

  // Prepare the email options
  const mailOptions = {
    from: `${senderName} <${senderEmail}>`,
    sender: process.env.ADMIN_SMTP_EMAIL,
    to: recipient,
    subject: subject,
    text: plainTextBodyWithCampaignId,
    html: html,
    replyTo: replyToEmail || senderEmail,
    attachDataUrls: true,
  } satisfies Options;

  if (process.env.SKIP_SMTP_SEND === "SKIP") {
    return {
      messageId: String(Math.random()),
      accepted: [],
      rejected: [],
      response: "SKIP",
    };
  }

  const decryptedPass = decryptToken(smtpCredentials.encryptedPass);
  const info = await sendNodemailerEmailRaw(
    {
      host: smtpCredentials.host,
      port: smtpCredentials.port,
      secure: smtpCredentials.port === 465,
      user: smtpCredentials.user,
      pass: decryptedPass,
    },
    mailOptions,
  );

  Debug.log("Email sent:", info.messageId);
  return info;
}

export async function smtpErrorHandler(error: unknown, job: Job<AddSMTPRouteParamsType>) {
  if (!(error instanceof Error && "responseCode" in error && typeof error.responseCode === "number")) throw error;

  const responseCode = error.responseCode;
  if (ErrorCodesToRetrySMTPEmailAfterOneDay.includes(responseCode)) {
    Debug.log("Error code " + responseCode + " detected. Delaying email sending for 1 day......");
    if (!job.data.campaignOrg.id) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Campaign organization id not found", false, "HIGH");
    }

    const ONE_DAY_IN_SECONDS = 86400;
    await smtpQueue.delayRemainingJobs(job, ONE_DAY_IN_SECONDS);
    return;
  }

  Debug.error("[SMTP_WORKER] Fail to send email. Error code " + responseCode + " detected.", error);
  throw error;
}
