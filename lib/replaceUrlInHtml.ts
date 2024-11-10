export function replaceUrlsInEmailHtml(campaign: { id: string; bodyHTML: string }, emailId: string) {
  const linkPattern = /<a\s+[^>]*href="(https?:\/\/[^\s"'<>]+)"/gi;

  campaign.bodyHTML = campaign.bodyHTML.replace(linkPattern, (match, url) => {
    const encodedUrl = encodeURIComponent(url);
    return match.replace(
      url,
      `${process.env.MAIN_APP_BASE_URL}api/email-track-click?campaignId=${campaign.id}&emailId=${emailId}&url=${encodedUrl}`
    );
  });

  return campaign.bodyHTML;
}
