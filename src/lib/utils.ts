/* eslint-disable @typescript-eslint/no-explicit-any */
import { DateTime, Info } from "luxon";
import dotenv from "dotenv";
import { skyfunnelSesQueue, smtpQueue } from "../server/emails";
import { Job } from "bullmq";
dotenv.config();

/**
 * Checks if the given string is a numeric string. and can be safely parsed as a number
 * @param str - The string to check is is numeric
 * @returns boolean - true if the string is numeric, false otherwise
 */
export function isNumeric(str: string) {
  if (typeof str !== "string") {
    return false;
  }
  return !isNaN(parseFloat(str)) && isFinite(parseInt(str));
}

/**
 * Generates a random job id for the given campaignId and emailId.
 * @param campaignId - The campaignId of the email
 * @param emailId - The emailId of the email
 * @returns A random job id
 */
export const generateJobId = (campaignId: string, emailId: string, type: "SES" | "SMTP") => {
  const randomJobId = crypto.randomUUID();
  return `${type}-${campaignId}-${emailId}-${randomJobId.slice(0, 8)}`;
};

/**
 * Replaces all URLs in the given email HTML with the corresponding URL tracking links.
 * @param campaign - The campaign object containing the email HTML
 * @param emailId - The emailId of the email
 * @returns The updated html with URL tracking links
 */
export function replaceUrlsInEmailHtml(campaign: { id: string; bodyHTML: string }, emailId: string) {
  // Matches URLs in href attributes, with or without "http" or "https" (e.g., "https://example.com" or "app.skyfunnel.ai")
  const linkPattern = /<a\s+[^>]*href="((https?:\/\/|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})([^\s"'<>]*))"/gi;

  campaign.bodyHTML = campaign.bodyHTML.replace(linkPattern, (match, url) => {
    const encodedUrl = encodeURIComponent(url);
    return match.replace(
      url,
      `${process.env.MAIN_APP_BASE_URL}api/email-track-click?campaignId=${campaign.id}&emailId=${emailId}&url=${encodedUrl}`,
    );
  });

  return campaign.bodyHTML;
}

export const isDevelopment = process.env.NODE_ENV === "development";

export const getDelayedJobId = (jobId: string) => {
  const baseJobId = jobId?.split("-delayed")[0];
  const delayCountMatch = jobId?.match(/-delayed-(\d+)$/);
  const delayCount = delayCountMatch ? parseInt(delayCountMatch[1], 10) : 0;

  // Generate a new job ID with an incremented delay count
  const newJobId = `${baseJobId}-delayed-${delayCount + 1}`;

  return newJobId;
};

export const convertHtmlToText = (html: string) => {
  const plainTextBody = html
    .replace(/<br\s*\/?>/g, "\n") // Replace HTML line breaks with newlines
    .replace(/<\/?[^>]+(>|$)/g, ""); // Strip out all HTML tags

  return plainTextBody;
};

export class Debug {
  public static devLog(...args: any[]) {
    if (
      process.env.NODE_ENV === "development" ||
      process.env.SMTP_DEBUG === "true" ||
      process.env.LOGS_DEBUG === "true"
    ) {
      console.log("[DEV]", ...args);
    }
  }

  public static log(...args: any[]) {
    console.log(...args);
  }

  public static error(...args: any[]) {
    console.error(...args);
  }
}

/**
 * Checks if current time is within the given period.
 * @param startTimeUTC start time for utc time with format HH:mm
 * @param endTimeUTC start time for utc time with format HH:mm
 * @returns boolean
 * @throws Error if startTimeUTC or endTimeUTC is not in the correct format
 * @example
 * isWithinPeriod("13:00", "14:00") // true
 * isWithinPeriod("13:00", "13:00") // true
 * isWithinPeriod("13:00", "14:00") // false
 */
export function isWithinPeriod(startTimeUTC: string | null, endTimeUTC: string | null): boolean {
  if (!startTimeUTC || !endTimeUTC) return true;
  if (startTimeUTC.split(":").length !== 2 || endTimeUTC.split(":").length !== 2)
    throw new Error("Invalid time format. Use HH:mm format");

  // Get current UTC time (ignoring date)
  const now = DateTime.utc();

  // Parse stored UTC times
  const start = DateTime.fromFormat(startTimeUTC, "HH:mm", { zone: "utc" });
  const end = DateTime.fromFormat(endTimeUTC, "HH:mm", { zone: "utc" });

  return now.toFormat("HH:mm") >= start.toFormat("HH:mm") && now.toFormat("HH:mm") <= end.toFormat("HH:mm");
}

export enum Days {
  MONDAY = "MONDAY",
  TUESDAY = "TUESDAY",
  WEDNESDAY = "WEDNESDAY",
  THURSDAY = "THURSDAY",
  FRIDAY = "FRIDAY",
  SATURDAY = "SATURDAY",
  SUNDAY = "SUNDAY",
}
export function isActiveDay(activeDays: Days[], timezone: string = "UTC"): boolean {
  // Use luxon to get the current day in the specified timezone
  const today = DateTime.now().setZone(timezone);
  const todayDayName = today.toFormat("cccc").toUpperCase();

  return activeDays.includes(todayDayName as Days);
}

export const generateRandomDelay = (currentInterval: number) => {
  // generates a random delay between 20 to 90 seconds and adds it to the current interval. (ms)

  const randomDelay = Math.floor(Math.random() * (90 - 20 + 1)) + 20;
  const newRandomDelay = currentInterval * 1000 + randomDelay * 1000;
  return newRandomDelay;
};

export function getNextActiveTime(
  activeDays: Days[],
  startTimeUTC: string
): DateTime {
  const now = DateTime.utc();

  // Map `Days` enum to Luxon's numeric weekdays (1=Mon, 7=Sun)
  const dayNames = Info.weekdays('long'); // ["Monday", "Tuesday", ..., "Sunday"]
  const activeDaysIndex = activeDays.map(
    (day) => dayNames.indexOf(day.charAt(0) + day.slice(1).toLowerCase()) + 1
  );

  // Extract start hour & minute
  const [startHour, startMinute] = startTimeUTC.split(':').map(Number);
  const todayStart = now.set({
    hour: startHour,
    minute: startMinute,
    second: 0,
  });

  // If today is an active day & it's before start time, schedule for today
  if (activeDaysIndex.includes(now.weekday) && now < todayStart) {
    return todayStart;
  }

  // Find the next available active day
  let daysToAdd = 1;
  while (!activeDaysIndex.includes(now.plus({ days: daysToAdd }).weekday)) {
    daysToAdd++;
  }

  return now
    .plus({ days: daysToAdd })
    .set({ hour: startHour, minute: startMinute, second: 0 });
}

export async function delayAllSkyfCampaignJobsTillNextValidTime(currentJob: Job, nextActiveTime: DateTime) {
  const queue = skyfunnelSesQueue.getQueue();
  const jobs = await queue.getJobs(["delayed", "waiting"]);

  const jobsToReschedule = jobs.filter((job) => job.data.email.campaignId === currentJob.data.email.campaignId);

  if (jobs.length === 0) {
    console.log("[SKYFUNNEL_WORKER] No jobs found, only rescheduling the current job.");
  }
  let lastScheduledTime = nextActiveTime;
  const nextValidTimeDelay = lastScheduledTime.toMillis() - DateTime.now().toMillis();
  const newJobId = getDelayedJobId(
    currentJob.id || generateJobId(currentJob.data.email.emailCampaignId, currentJob.data.email.id, "SES"),
  );
  await queue.add(currentJob.data.email.id, currentJob.data, {
    ...currentJob.opts,
    delay: nextValidTimeDelay,
    jobId: newJobId,
  });
  console.log(
    `[SKYFUNNEL_WORKER] New delayed job added to queue with a delay of ${nextValidTimeDelay} ms to be sent at ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
  );

  // Sort jobs by their original intended execution time if available
  jobs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const delayPromises = jobsToReschedule.map(async (job) => {
    lastScheduledTime = lastScheduledTime.plus({ milliseconds: job.data.actualInterval });

    const delay = lastScheduledTime.toMillis() - DateTime.now().toMillis();

    // Ensure delay is non-negative
    if (delay < 0) {
      console.warn(`[SKYFUNNEL_WORKER] Skipping job ${job.id}, as the delay is negative.`);
      return Promise.resolve(); // Skip this job, but maintain structure
    }

    const delayedTimestamp = new Date(Date.now() + delay).getTime();
    console.log(`[SKYFUNNEL_WORKER] Rescheduled Job ${job.id} to ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")}`);

    return job.changeDelay(delayedTimestamp, undefined);
  });

  const results = await Promise.allSettled(delayPromises);

  const failedJobs = results.filter((result) => result.status === "rejected");
  failedJobs.forEach((result, index) => {
    console.error(`Failed to delay job ${jobsToReschedule[index]?.id}:`, result.reason);
  });
}

export async function delayAllSMTPCampaignJobsTillNextValidTime(currentJob: Job, nextActiveTime: DateTime) {
  const queue = smtpQueue.getQueue();
  const jobs = await queue.getJobs(["delayed", "waiting"]);

  const jobsToReschedule = jobs.filter((job) => job.data.email.campaignId === currentJob.data.email.campaignId);

  if (jobs.length === 0) {
    console.log("[SMTP_WORKER] No jobs found, only rescheduling the current job.");
  }
  let lastScheduledTime = nextActiveTime;
  const nextValidTimeDelay = lastScheduledTime.toMillis() - DateTime.now().toMillis();
  const newJobId = getDelayedJobId(
    currentJob.id || generateJobId(currentJob.data.email.emailCampaignId, currentJob.data.email.id, "SES"),
  );
  await queue.add(currentJob.data.email.id, currentJob.data, {
    ...currentJob.opts,
    delay: nextValidTimeDelay,
    jobId: newJobId,
  });
  console.log(
    `[SMTP_WORKER] New delayed job added to queue with a delay of ${nextValidTimeDelay} ms to be sent at ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
  );

  // Sort jobs by their original intended execution time if available
  jobs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const delayPromises = jobsToReschedule.map(async (job) => {
    lastScheduledTime = lastScheduledTime.plus({ milliseconds: job.data.actualInterval });

    const delay = lastScheduledTime.toMillis() - DateTime.now().toMillis();

    // Ensure delay is non-negative
    if (delay < 0) {
      console.warn(`[SMTP_WORKER] Skipping job ${job.id}, as the delay is negative.`);
      return Promise.resolve(); // Skip this job, but maintain structure
    }

    const delayedTimestamp = new Date(Date.now() + delay).getTime();
    console.log(`[SMTP_WORKER] Rescheduled Job ${job.id} to ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")}`);

    return job.changeDelay(delayedTimestamp, undefined);
  });

  const results = await Promise.allSettled(delayPromises);

  const failedJobs = results.filter((result) => result.status === "rejected");
  failedJobs.forEach((result, index) => {
    console.error(`Failed to delay job ${jobsToReschedule[index]?.id}:`, result.reason);
  });
}
