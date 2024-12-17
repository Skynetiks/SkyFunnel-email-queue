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
}


export const convertHtmlToText = (html: string) => {
  const plainTextBody = html
  .replace(/<br\s*\/?>/g, "\n") // Replace HTML line breaks with newlines
  .replace(/<\/?[^>]+(>|$)/g, ""); // Strip out all HTML tags

  return plainTextBody;
}