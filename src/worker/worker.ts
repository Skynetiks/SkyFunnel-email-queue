import { Worker, Job } from "bullmq";
import { EMAIL_QUEUE_KEY, QUEUE_CONFIG } from "../config";
import { query } from "../lib/db";
import { AddEmailRouteParamsSchema } from "../server/types/emailQueue";
import { sendEmailAndUpdateStatus } from "./send-email";
import { AppError, errorHandler } from "../lib/errorHandler";
import { isCampaignPaused } from "../server/emails";
import { getQueue } from "../server/queue";

const handleJob = async (job: Job) => {
  console.log("Job Started with jobID", job.id);
  const data = job.data;
  try {
    const validatedData = AddEmailRouteParamsSchema.safeParse(data);
    if (!validatedData.success) {
      throw new AppError("BAD_REQUEST", validatedData.error.errors[0].message);
    }

    const { email, campaignOrg } = validatedData.data;
    const isPaused = await isCampaignPaused(email.emailCampaignId);
    console.log("isPaused", isPaused);
    if (isPaused) {
      const DELAY_TIME = 1000 * QUEUE_CONFIG.delayAfterPauseInSeconds;

      try {
        const queue = await getQueue();

        const baseJobId = job.id?.split("-delayed")[0];
        const delayCountMatch = job.id?.match(/-delayed-(\d+)$/);
        const delayCount = delayCountMatch ? parseInt(delayCountMatch[1], 10) : 0;

        // Generate a new job ID with an incremented delay count
        const newJobId = `${baseJobId}-delayed-${delayCount + 1}`;

        await queue.add(email.id, data, { ...job.opts, delay: DELAY_TIME, jobId: newJobId });

        console.log(`New delayed job added to queue with a delay of ${DELAY_TIME} ms`);
      } catch (moveError) {
        console.error("Failed to move job to delayed queue", moveError);
      }

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    // await sendEmailAndUpdateStatus(email, campaignOrg);
  } catch (error) {
    errorHandler(error, true);
  }
};

const redisUrl = process.env.REDIS_URL;

const worker = new Worker(EMAIL_QUEUE_KEY, handleJob, {
  concurrency: QUEUE_CONFIG.concurrency,

  connection: {
    url: redisUrl,
  },
  lockDuration: 30000, // ensure a longer lock duration,
});

worker.on("failed", async (job) => {
  if (job && "id" in job.data) {
    await query('UPDATE "Email" SET status = $1 WHERE id = $2', ["ERROR", job.data.id]);
  }

  console.error("Job failed");
});

worker.on("completed", () => {
  console.log("Job completed");
});

worker.on("ready", () => {
  console.log("Worker is ready");
});
