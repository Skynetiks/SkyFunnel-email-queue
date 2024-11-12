import { Queue } from "bullmq";
import { ADMIN_WORKER_QUEUE_KEY } from "../config";

let adminEmailQueue: Queue | undefined;

export const getAdminEmailQueue = async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  if (!adminEmailQueue) {
    adminEmailQueue = new Queue(ADMIN_WORKER_QUEUE_KEY, {
      connection: {
        url: redisUrl,
      },
    });
  }

  return adminEmailQueue;
};
