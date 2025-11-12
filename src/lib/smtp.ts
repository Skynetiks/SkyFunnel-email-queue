import nodemailer from "nodemailer";
import DKIM from "nodemailer/lib/dkim";
import { Attachment, Options } from "nodemailer/lib/mailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { v4 as uuidv4 } from "uuid";
import { convertHtmlToText } from "./utils";
import { Debug } from "./debug";
import { AddSMTPRouteParamsType, SMTPCredentials } from "../server/types/smtpQueue";
import { decryptToken } from "./decrypt";
import { ErrorCodesToRetrySMTPEmailAfterOneDay, getRandomIP } from "../config";
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
  specificIP?: string,
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

    const selectedIP = specificIP || getRandomIP();
    console.log(`[SMTP] Using IP address: ${selectedIP} for email to ${recipient}`);

    const info = await sendNodemailerEmailRaw(
      {
        host: process.env.SMTP_HOST!,
        port: 465,
        secure: true,
        user: process.env.ADMIN_SMTP_EMAIL!,
        pass: process.env.ADMIN_SMTP_PASS!,
        localAddress: selectedIP,
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
  localAddress?: string;
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

  private generateKey({ host, user, localAddress }: { host: string; user: string; localAddress?: string }) {
    return `${host}_${user}_${localAddress || "default"}`; // Include localAddress in key
  }

  getOrCreateTransporter({ host, port, secure, user, pass, localAddress }: Credentials) {
    const key = this.generateKey({ host, user, localAddress });

    if (this.transporters.has(key)) {
      // Update lastUsed timestamp and return existing transporter
      const entry = this.transporters.get(key)!;
      entry.lastUsed = Date.now();
      return entry.transporter;
    }

    try {
      // Create a new transporter with localAddress support
      const transporterConfig = {
        host,
        port,
        secure,
        pool: true,
        auth: { user, pass },
        debug: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
        logger: process.env.NODE_ENV === "development" && process.env.SMTP_DEBUG !== "false",
        maxConnections: 5, // Limit connections
        maxMessages: 100,
      };

      // Add localAddress if provided
      if (localAddress) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (transporterConfig as any).localAddress = localAddress;
      }

      const transporter = nodemailer.createTransport(transporterConfig);

      this.transporters.set(key, { transporter, lastUsed: Date.now() });
      return transporter;
    } catch (error) {
      Debug.error(`Failed to create transporter for ${key}:`, error);
      throw error;
    }
  }

  getTransporter({ host, user, localAddress }: { host: string; user: string; localAddress?: string }) {
    const key = this.generateKey({ host, user, localAddress });
    const entry = this.transporters.get(key);
    if (entry) {
      entry.lastUsed = Date.now(); // Update lastUsed timestamp
      return entry.transporter;
    }
    return null;
  }

  closeTransporter({ host, user, localAddress }: { host: string; user: string; localAddress?: string }) {
    const key = this.generateKey({ host, user, localAddress });
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

async function sendNodemailerEmailRaw({ host, port, secure, user, pass, localAddress }: Credentials, options: Options) {
  const instance = NodemailerTransporter.getInstance();

  const transporter = instance.getOrCreateTransporter({ host, port, secure, user, pass, localAddress });
  if (!transporter) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Failed to create transporter");
  }

  try {
    const info = await transporter.sendMail(options);
    return info as SMTPTransport.SentMessageInfo;
  } finally {
    instance?.closeTransporter({ host, user, localAddress });
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
  unsubscribeUrl?: string;
  attachments?: Attachment[];
};

export async function sendSMTPEmail(email: Email, smtpCredentials: SMTPCredentials, specificIP?: string) {
  const { body, senderEmail, senderName, recipient, subject, replyToEmail, campaignId, attachments } = email;
  const plainTextBody = convertHtmlToText(body);
  const campaignIdHtml = campaignId ? `<p style='display:none'>thread::${campaignId}</p>` : "";
  const plainTextBodyWithCampaignId = campaignId ? `${plainTextBody} thread::${campaignId}` : plainTextBody;
  const html = `${body} ${campaignIdHtml}`;

  // Prepare the email options
  const mailOptions = {
    from: `${senderName} <${senderEmail}>`,
    sender: senderEmail,
    to: recipient,
    subject: subject,
    text: plainTextBodyWithCampaignId,
    html: html,
    replyTo: replyToEmail || senderEmail,
    headers: {
      ...(email.unsubscribeUrl && {
        "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    },
    attachDataUrls: true,
    attachments: attachments || [],
  } satisfies Options;

  if (process.env.SKIP_SMTP_SEND === "SKIP") {
    return {
      messageId: String(Math.random()),
      accepted: [],
      rejected: [],
      response: "SKIP",
    };
  }

  // Use specific IP if provided, otherwise get a random IP
  const selectedIP = specificIP || getRandomIP();
  console.log(`[SMTP] Using IP address: ${selectedIP} for email to ${recipient}`);

  const decryptedPass = decryptToken(smtpCredentials.encryptedPass);
  const info = await sendNodemailerEmailRaw(
    {
      host: smtpCredentials.host,
      port: smtpCredentials.port,
      secure: smtpCredentials.port === 465,
      user: smtpCredentials.user,
      pass: decryptedPass,
      localAddress: selectedIP,
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
    Debug.log("Error code " + responseCode + " detected. Delaying email sending for 8 hours......");
    if (!job.data.campaignOrg.id) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Campaign organization id not found", false, "HIGH");
    }

    const EIGHT_HOURS_IN_SECONDS = 28800;
    await smtpQueue.delayRemainingJobsForSender(job, EIGHT_HOURS_IN_SECONDS);
    return;
  }

  Debug.error("[SMTP_WORKER] Fail to send email. Error code " + responseCode + " detected.", error);
  throw error;
}
