import { Queue } from "bullmq";
import { SES_SKYFUNNEL_EMAIL_QUEUE_KEY, SMTP_EMAIL_QUEUE_KEY } from "../config";

class EmailQueue {
  public smtpQueue: Queue | undefined;
  public skyfunnelSesQueue: Queue | undefined;

  constructor(redisUrl: string) {
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }

    console.log("INITIALIZING QUEUES");

    this.smtpQueue = new Queue(SMTP_EMAIL_QUEUE_KEY, {
      connection: {
        url: redisUrl,
      },
    });

    this.skyfunnelSesQueue = new Queue(SES_SKYFUNNEL_EMAIL_QUEUE_KEY, {
      connection: {
        url: redisUrl,
      },
    });
  }

  public getSMTPInstance() {
    return this.smtpQueue;
  }

  public getSkyfunnelInstance() {
    return this.skyfunnelSesQueue;
  }
}

export const emailQueueManager = new EmailQueue(process.env.REDIS_URL!);
