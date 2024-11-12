import { DEFAULT_JOB_OPTIONS, DefaultPrioritySlug, getPriority, PAUSE_CAMPAIGN_LIST_KEY } from "../config";
import { AppError } from "../lib/errorHandler";
import { getRedisConnection } from "../lib/redis";
import { generateJobId } from "../lib/utils";
import { getQueue } from "./queue";
import { AddBulkRouteParamsType, AddEmailRouteParamsType } from "./types/emailQueue";

export const addBulkEmailsToQueue = async (
  { campaignOrg, emails, interval }: AddBulkRouteParamsType,
  prioritySlug: string = DefaultPrioritySlug,
) => {
  if (!emails.length || !emails[0]?.emailCampaignId) {
    throw new AppError("BAD_REQUEST", "Either emails or emailCampaignId is missing");
  }

  const emailQueue = await getQueue();
  if (!emailQueue) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Queue not initialized Successfully", false, "HIGH");
  }

  const priorityNumber = getPriority(prioritySlug);

  const jobs = emails.map((email, index) => {
    const delay = index * interval * 1000;
    const jobId = generateJobId(email.emailCampaignId, email.id);

    return {
      name: email.id,
      data: { email, campaignOrg },
      opts: { ...DEFAULT_JOB_OPTIONS, delay, jobId, priority: priorityNumber },
    };
  });

  await emailQueue.addBulk(jobs);
};

export const addEmailToQueue = async (
  { email, campaignOrg }: AddEmailRouteParamsType,
  prioritySlug: string = DefaultPrioritySlug,
) => {
  const emailQueue = await getQueue();
  if (!emailQueue) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Queue not initialized Successfully", false, "HIGH");
  }

  const priorityNumber = getPriority(prioritySlug);

  const jobId = generateJobId(email.emailCampaignId, email.id);

  await emailQueue.add(
    email.id,
    { email, campaignOrg },
    { ...DEFAULT_JOB_OPTIONS, jobId: jobId, priority: priorityNumber },
  );
};

export const cancelEmails = async (campaignId: string) => {
  const emailQueue = await getQueue();
  const redisClient = await getRedisConnection();

  if (!emailQueue || !redisClient) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Queue Or Redis not initialized Successfully", false, "HIGH");
  }

  console.time();

  const jobs = await emailQueue.getJobs(["delayed", "paused", "waiting"]);

  // Filter jobs to cancel only those with the specified campaignId in their job ID
  const jobsToCancel = jobs.filter((job) => job.id?.includes(campaignId));

  const jobsCancelPromises = jobsToCancel.map(async (job) => {
    job.remove();
  });

  await Promise.allSettled(jobsCancelPromises);
  console.timeEnd();
  return jobsToCancel.length;
};

// =================================== Pause and Resume Campaign ===================================

export const pauseCampaign = async (campaignId: string) => {
  const redisClient = await getRedisConnection();
  if (!redisClient) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Redis not initialized Successfully", false, "HIGH");
  }

  const isPaused = await isCampaignPaused(campaignId);
  if (isPaused) {
    throw new AppError("BAD_REQUEST", "Campaign is already paused");
  }

  const response = await redisClient.sadd(PAUSE_CAMPAIGN_LIST_KEY, campaignId);
  if (!response) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Something Went Wrong while pausing campaign", false, "HIGH");
  }

  return true;
};

export const resumeCampaign = async (campaignId: string) => {
  const redisClient = await getRedisConnection();
  if (!redisClient) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Redis not initialized Successfully", false, "HIGH");
  }

  const isPaused = await isCampaignPaused(campaignId);
  if (!isPaused) {
    throw new AppError("BAD_REQUEST", "Campaign is not paused");
  }

  const response = await redisClient.srem(PAUSE_CAMPAIGN_LIST_KEY, campaignId);
  if (!response) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Something Went Wrong while resuming campaign", false, "HIGH");
  }

  return true;
};

export const getPausedCampaigns = async () => {
  const redisClient = await getRedisConnection();
  if (!redisClient) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Redis not initialized Successfully", false, "HIGH");
  }

  const pausedCampaigns = await redisClient.smembers(PAUSE_CAMPAIGN_LIST_KEY);
  return pausedCampaigns;
};

export const isCampaignPaused = async (campaignId: string) => {
  const redisClient = await getRedisConnection();
  if (!redisClient) {
    throw new AppError("INTERNAL_SERVER_ERROR", "Redis not initialized Successfully", false, "HIGH");
  }

  const isPaused = await redisClient.sismember(PAUSE_CAMPAIGN_LIST_KEY, campaignId);
  return !!isPaused;
};
