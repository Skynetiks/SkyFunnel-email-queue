import { JobsOptions } from "bullmq";

export const SMTP_EMAIL_QUEUE_KEY = "SMTP_EMAIL_SENDING_QUEUE";
export const SES_SKYFUNNEL_EMAIL_QUEUE_KEY = "SES_SKYFUNNEL_EMAIL_SENDING_QUEUE";
export const SENDER_IDENTITY_KEY = "SENDER_IDENTITY_SENDING_QUEUE";

export const PAUSE_CAMPAIGN_LIST_KEY = `EMAIL_SENDING_QUEUE:pause-campaign-list`;

export const QUEUE_CONFIG = {
  concurrency: 1,
  retries: 3,

  delayAfterPauseInSeconds: 60 * 30, // [30 mins] delay after any campaign is paused until it is rechecked. suggested to be higher to save resources.
};

export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
  attempts: QUEUE_CONFIG.retries,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
} satisfies JobsOptions;

// Highest Priority is 0 and lowest priority is 100
// High Priority Job runs first and same priority jobs run in FIFO
export const PriorityObject = {
  MOST_IMPORTANT: 1,
  HIGH: 5,
  MEDIUM: 10, // Default Priority
  LOW: 50,
} as const;
export type Priority = keyof typeof PriorityObject;

export const DefaultPrioritySlug: Priority = "MEDIUM";

export const isValidPriority = (priority: string): priority is Priority => {
  return Object.keys(PriorityObject).includes(priority as Priority);
};

export const getPriority = (priority: string): number => {
  if (!isValidPriority(priority)) {
    return PriorityObject.MEDIUM;
  }

  return PriorityObject[priority];
};

export const permanentErorrCodesForSMTP = [550, 551, 552, 553, 554];
export const temporaryErrorCodes = [454];

// ============================== Admin Worker ==============================

export const ADMIN_WORKER_QUEUE_KEY = "EMAIL_ADMIN_WORKER_QUEUE";

export const ADMIN_WORKER_QUEUE_CONFIG = {
  concurrency: 10,
  retries: 3,

  senderEmail: "noreply@skyfunnel.ai",
  senderName: "SkyFunnel.ai",
  replyToEmail: "noreply@skyfunnel.ai",
};

export const ADMIN_DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
  attempts: ADMIN_WORKER_QUEUE_CONFIG.retries,
  delay: 2000,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
} satisfies JobsOptions;

// ============================== IP Pool Configuration ==============================

export const IP_POOL = JSON.parse(process.env.IP_POOL || "[]");

export const getRandomIP = (): string => {
  const randomIndex = Math.floor(Math.random() * IP_POOL.length);
  return IP_POOL[randomIndex];
};
