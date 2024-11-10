function replaceUrlsInEmailHtml(campaign: {id: string, bodyHTML: string}, emailId: string) {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;

  campaign.bodyHTML = campaign.bodyHTML.replace(urlPattern, (url) => {
    const encodedUrl = encodeURIComponent(url);
    return `${process.env.MAIN_APP_BASE_URL}/email-track-click?campaignId=${campaign.id}&emailId=${emailId}&url=${encodedUrl}`;
  });

  return campaign.bodyHTML;
}
