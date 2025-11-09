import { DateTime, Info } from "luxon";
import dotenv from "dotenv";
import { smtpQueue } from "../server/emails";
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
      `${process.env.MAIN_APP_BASE_URL}/api/email-track-click?campaignId=${campaign.id}&emailId=${emailId}&url=${encodedUrl}`,
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
  if (activeDays.length === 0) return true;
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

export function getNextActiveTime(activeDays: Days[], startTimeUTC: string): DateTime {
  const now = DateTime.utc();

  // Map `Days` enum to Luxon's numeric weekdays (1=Mon, 7=Sun)
  const dayNames = Info.weekdays("long"); // ["Monday", "Tuesday", ..., "Sunday"]
  const activeDaysIndex = activeDays.map((day) => dayNames.indexOf(day.charAt(0) + day.slice(1).toLowerCase()) + 1);

  // Extract start hour & minute
  const [startHour, startMinute] = startTimeUTC.split(":").map(Number);
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

  return now.plus({ days: daysToAdd }).set({ hour: startHour, minute: startMinute, second: 0 });
}

export async function delayAllSMTPCampaignJobsTillNextValidTime(currentJob: Job, nextActiveTime: DateTime) {
  const queue = smtpQueue.getQueue();
  const jobs = await queue.getJobs(["delayed", "waiting"]);
  const jobsToReschedule = jobs.filter(
    (job) => job.data.email.emailCampaignId === currentJob.data.email.emailCampaignId,
  );

  if (jobsToReschedule.length === 0) {
    console.log("[SMTP_WORKER] No jobs found to reschedule, only rescheduling the current job.");
  }
  let lastScheduledTime = nextActiveTime;
  const nextValidTimeDelay = lastScheduledTime.toMillis() - DateTime.now().toMillis();
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newJobs: Array<{ name: string; data: any; opts: any }> = [];

  // Add the current job first
  const newJobId = getDelayedJobId(
    currentJob.id || generateJobId(currentJob.data.email.emailCampaignId, currentJob.data.email.id, "SMTP"),
  );
  
  newJobs.push({
    name: currentJob.data.email.id,
    data: currentJob.data,
    opts: {
      ...currentJob.opts,
      delay: nextValidTimeDelay,
      jobId: newJobId,
    }
  });

  console.log(
    `[SMTP_WORKER] Will add current job with delay of ${nextValidTimeDelay}ms to be sent at ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")}`,
  );

  // Remove all old jobs
  if (jobsToReschedule.length > 0) {
    await Promise.all(jobsToReschedule.map(job => job.remove()));
    console.log(`[SMTP_WORKER] Removed ${jobsToReschedule.length} old jobs`);
  }

  // Sort jobs by their original intended execution time if available
  jobsToReschedule.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Re-add remaining jobs with correct delays
  for (const job of jobsToReschedule) {
    lastScheduledTime = lastScheduledTime.plus({ milliseconds: job.data.actualInterval });
    const delay = lastScheduledTime.toMillis() - DateTime.now().toMillis();
    
    if (delay < 0) {
      console.warn(`[SMTP_WORKER] Skipping job ${job.id}, negative delay`);
      continue;
    }

    newJobs.push({
      name: job.data.email.id,
      data: job.data,
      opts: {
        priority: job.opts.priority,
        removeOnFail: job.opts.removeOnFail,
        removeOnComplete: job.opts.removeOnComplete,
        backoff: job.opts.backoff,
        attempts: job.opts.attempts,
        delay: delay,
        jobId: generateJobId(job.data.email.emailCampaignId, job.data.email.id, "SMTP"),
      }
    });

    console.log(`[SMTP_WORKER] Will reschedule job ${job.id} to ${lastScheduledTime.toFormat("yyyy-MM-dd HH:mm:ss")} with delay ${delay}ms`);
  }

  // Add all jobs in bulk (including current job)
  if (newJobs.length > 0) {
    await queue.addBulk(newJobs);
    console.log(`[SMTP_WORKER] Re-added ${newJobs.length} jobs successfully (including current job)`);
  }
}