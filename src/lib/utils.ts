/* eslint-disable @typescript-eslint/no-explicit-any */
import { DateTime } from "luxon";
import dotenv from "dotenv";
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

export const generateRandomDelay = (currentInterval: number) => {

  // generates a random delay between 20 to 90 seconds and adds it to the current interval. (ms)

  const randomDelay = Math.floor(Math.random() * (90 - 20 + 1)) + 20;
  const newRandomDelay = (currentInterval * 1000) + (randomDelay * 1000);
  return newRandomDelay;
}