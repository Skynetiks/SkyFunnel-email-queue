import { Job, JobType, Queue } from "bullmq";
import { DEFAULT_JOB_OPTIONS, DefaultPrioritySlug, getPriority, PAUSE_CAMPAIGN_LIST_KEY } from "../config";
import { AppError } from "../lib/errorHandler";
import { getRedisConnection } from "../lib/redis";
import { generateJobId, generateRandomDelay } from "../lib/utils";
import { emailQueueManager } from "./queue";
import { AddBulkSMTPRouteParamType, AddSMTPRouteParamsType, SMTPJobOptions } from "./types/smtpQueue";

class BaseEmailQueue {
  protected emailQueue: Queue | undefined;

  constructor(queue: Queue) {
    this.emailQueue = queue;
  }

  async getBullMqStats() {
    const queue = this.emailQueue;
    const counts = await queue?.getJobCounts();

    return counts;
  }

  async getJobsByJobIdKeyword(keyword: string, types: JobType[] = ["delayed", "paused", "waiting"], chunkSize = 100) {
    let finalJobs: Job[] = [];
    let start = 0;

    while (true) {
      const queue = this.getQueue();
      const jobs = await queue.getJobs(types, start, start + chunkSize - 1);
      if (!jobs.length) break;
      finalJobs = finalJobs.concat(jobs.filter((job) => job.id?.includes(keyword)));
      start += chunkSize;
    }

    return finalJobs;
  }

  getQueue() {
    if (!this.emailQueue) {
      throw new AppError(
        "INTERNAL_SERVER_ERROR",
        "Queue not initialized Successfully or Called before initialization",
        false,
        "HIGH",
      );
    }
    return this.emailQueue;
  }

  /**
   * Delays remaining jobs and create a new job with the delay for the existing job
   * @param campaignId
   * @param delayInSeconds
   * @returns
   */
  async delayRemainingJobs(currentJob: Job, delayInSeconds: number) {
    const campaignId = currentJob.data.email.emailCampaignId;
    const jobs = await this.getJobsByJobIdKeyword(campaignId, ["delayed", "paused", "waiting"]);
    if (!jobs.length) {
      console.log(`No jobs found for campaignId: ${campaignId}`);
      return 0;
    }

    console.time("Delay remaining jobs");

    const delayedTimestamp = new Date(Date.now() + delayInSeconds * 1000).getTime();
    const jobsDelayPromise = jobs.map(async (job) => {
      const state = await job.getState();
      if (["waiting", "paused"].includes(state)) return;

      if (state === "delayed") {
        job.changeDelay(delayInSeconds * 1000);
      } else {
        job.moveToDelayed(delayedTimestamp, undefined);
      }
    });

    const results = await Promise.allSettled(jobsDelayPromise);

    const failedJobs = results.filter((result) => result.status === "rejected");
    failedJobs.forEach((result, index) => {
      console.error(`Failed to delay job ${jobs[index]?.id}:`, result.reason);
    });

    //add new job with the currents job data and delay
    const { email, campaignOrg } = currentJob.data;
    try {
      await smtpQueue.addEmailToQueue({ email, campaignOrg }, "default", delayInSeconds);
      console.log(`[SMTP_WORKER] New delayed job added to queue with a delay of ${delayInSeconds * 1000} ms`);
    } catch (moveError) {
      console.error("[SMTP_WORKER] Failed to add job to queue", moveError);
    }

    console.timeEnd("Delay remaining jobs");

    return { successJobs: results.length - failedJobs.length, failedJobs: failedJobs.length };
  }

  /**
   * Delays remaining jobs for a specific sender and creates a new job with delay for the current job
   * @param currentJob - The current job being processed
   * @param delayInSeconds - Delay duration in seconds
   * @returns Object with counts of successful and failed job delays
   */
  async delayRemainingJobsForSender(currentJob: Job, delayInSeconds: number) {
    const campaignId = currentJob.data.email.emailCampaignId;
    const senderEmail = currentJob.data.email.senderEmail;

    if (!senderEmail) {
      console.error("[SMTP_WORKER] No sender email found in job data");
      return { successJobs: 0, failedJobs: 0 };
    }

    const jobs = await this.getJobsByJobIdKeyword(campaignId, ["delayed", "paused", "waiting"]);

    // Filter jobs by sender
    const senderJobs = jobs.filter((job) => job.data?.email?.senderEmail === senderEmail);

    if (!senderJobs.length) {
      console.log(`No jobs found for campaignId: ${campaignId} and senderEmail: ${senderEmail}`);
      return { successJobs: 0, failedJobs: 0 };
    }

    console.log(`Found ${senderJobs.length} jobs for sender ${senderEmail} out of ${jobs.length} total campaign jobs`);
    console.time("Delay remaining jobs");

    const delayedTimestamp = new Date(Date.now() + delayInSeconds * 1000).getTime();
    const jobsDelayPromise = senderJobs.map(async (job) => {
      const state = await job.getState();
      if (["waiting", "paused"].includes(state)) return;

      if (state === "delayed") {
        await job.changeDelay(delayInSeconds * 1000);
      } else {
        await job.moveToDelayed(delayedTimestamp, undefined);
      }
    });

    const results = await Promise.allSettled(jobsDelayPromise);

    const failedJobs = results.filter((result) => result.status === "rejected");
    failedJobs.forEach((result, index) => {
      console.error(`Failed to delay job ${senderJobs[index]?.id}:`, result.reason);
    });

    // Add new job with the current job's data and delay
    const { email, campaignOrg } = currentJob.data;
    try {
      await smtpQueue.addEmailToQueue({ email, campaignOrg }, "default", delayInSeconds);
      console.log(
        `[SMTP_WORKER] New delayed job added to queue for sender ${senderEmail} with a delay of ${delayInSeconds * 1000} ms`,
      );
    } catch (moveError) {
      console.error("[SMTP_WORKER] Failed to add job to queue", moveError);
    }

    console.timeEnd("Delay remaining jobs");

    return { successJobs: results.length - failedJobs.length, failedJobs: failedJobs.length };
  }

  async cancelEmails(campaignId: string) {
    const emailQueue = this.emailQueue;
    const redisClient = await getRedisConnection();

    if (!emailQueue || !redisClient) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Queue Or Redis not initialized Successfully", false, "HIGH");
    }

    console.time();

    const jobs = await this.getJobsByJobIdKeyword(campaignId);

    // Filter jobs to cancel only those with the specified campaignId in their job ID
    const jobsToCancel = jobs.filter((job) => job.id?.includes(campaignId));

    const jobsCancelPromises = jobsToCancel.map(async (job) => {
      job.remove();
    });

    const results = await Promise.allSettled(jobsCancelPromises);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Failed to cancel job ${jobsToCancel[index]?.id}:`, result.reason);
      }
    });

    await redisClient.srem(PAUSE_CAMPAIGN_LIST_KEY, campaignId);

    console.timeEnd();
    return jobsToCancel.length;
  }
}

class SMTPQueue extends BaseEmailQueue {
  constructor() {
    const emailQueue = emailQueueManager.getSMTPInstance();
    if (!emailQueue) {
      throw new AppError("INTERNAL_SERVER_ERROR", "SkyFunnel Email Queue not initialized", false, "HIGH");
    }
    super(emailQueue);
  }

  async addBulkEmailsToQueue(
    { campaignOrg, emails, interval, batchDelay, includeDelay }: AddBulkSMTPRouteParamType,
    prioritySlug: string = DefaultPrioritySlug,
  ) {
    if (!emails.length || !emails[0]?.emailCampaignId) {
      throw new AppError("BAD_REQUEST", "Either emails or emailCampaignId is missing");
    }

    const emailQueue = this.emailQueue;
    if (!emailQueue) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Queue not initialized Successfully", false, "HIGH");
    }

    const priorityNumber = getPriority(prioritySlug);

    const jobs = emails.map((email, index) => {
      const actualInterval = includeDelay ? generateRandomDelay(interval) : interval * 1000;
      const delay = batchDelay * 1000 + index * actualInterval;
      const jobId = generateJobId(email.emailCampaignId, email.id, "SMTP");

      return {
        name: email.id,
        data: { email, campaignOrg, actualInterval },
        opts: { ...DEFAULT_JOB_OPTIONS, delay, jobId, priority: priorityNumber },
      };
    }) satisfies SMTPJobOptions;

    await emailQueue.addBulk(jobs);
  }

  async addEmailToQueue(
    { email, campaignOrg }: AddSMTPRouteParamsType,
    prioritySlug: string = DefaultPrioritySlug,
    delayInSeconds: number = 0,
  ) {
    const emailQueue = this.emailQueue;
    if (!emailQueue) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Queue not initialized Successfully", false, "HIGH");
    }

    const priorityNumber = getPriority(prioritySlug);

    const jobId = generateJobId(email.emailCampaignId, email.id, "SMTP");

    const data = { campaignOrg, email } satisfies AddSMTPRouteParamsType;

    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      jobId: jobId,
      priority: priorityNumber,
      delay: delayInSeconds * 1000, // Convert delay to milliseconds
    };
    await emailQueue.add(email.id, data, jobOptions);
  }
}

export const smtpQueue = new SMTPQueue();
