import { Queue } from "bullmq";
import { EMAIL_QUEUE_KEY } from "../config";

let emailQueue: Queue | undefined;

export const getQueue = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE_KEY, {
      connection: {
        url: redisUrl,
      },
    });
  }

  return emailQueue;
};
