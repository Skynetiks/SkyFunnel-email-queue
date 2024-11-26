import { Worker } from "bullmq";
import dotenv from "dotenv";

// import { handleJob } from './admin-sendmail';
import { getRedisConnection } from "../lib/redis";
import { handleJob } from "./email";
import { ADMIN_WORKER_QUEUE_CONFIG, ADMIN_WORKER_QUEUE_KEY } from "../config";

dotenv.config();

export async function initializeWorker() {
  const connection = await getRedisConnection();
  if (!connection) {
    throw new Error("Redis connection not available");
  }

  console.log("Initializing worker");

  const worker = new Worker(
    ADMIN_WORKER_QUEUE_KEY,
    async (job) => {
      await handleJob(job.data);

      return { success: true };
    },
    {
      connection,
      concurrency: ADMIN_WORKER_QUEUE_CONFIG.concurrency,
    },
  );

  console.log("Worker initialized");

  worker.on("completed", (job) => {
    console.log(`Job completed with result ${job.returnvalue}`);
  });

  worker.on("failed", (job, err) => {
    console.log(`Job failed with error ${err.message}`);
  });
}

initializeWorker();
