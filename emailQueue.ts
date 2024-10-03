import { Queue, Worker } from "bullmq";
import { sendEmailSES } from "./aws";
import { getRedisConnection } from "./redis";
import { query } from "./db";
import { CampaignOrg } from "./types";

type Email = {
	leadFirstName: string;
	leadLastName: string;
	leadEmail: string;
	leadCompanyName: string;
	id: string;
	leadId: string;
	senderId: string;
	isSentMessage: boolean;
	isRead: boolean;
	status: "QUEUED";
	timestamp: Date;
	emailCampaignId: string;
};

const sendEmail = async (email: Email, campaignOrg: { name: string; id: any; }) => {
	try {
		const leadResultsPromise = query('SELECT * FROM "Lead" WHERE id = $1 AND "isSubscribedToEmail" = true', [email.leadId]);
		const userResultsPromise = query('SELECT * FROM "User" WHERE id = $1;', [email.senderId]);
		const campaignPromise = query('SELECT ec.*, ect.* FROM "EmailCampaign" ec JOIN "EmailCampaignTemplate" ect ON ec."emailCampaignTemplateId" = ect.id WHERE ec.id = $1;', [email.emailCampaignId]);

		const [leadResult, userResult, campaignResult] = await Promise.all([leadResultsPromise, userResultsPromise, campaignPromise]);

		const user = userResult.rows[0];
		if (!user) throw new Error("User not found");

		const lead = leadResult.rows[0];
		if (!lead) throw new Error("Lead not found");

		const campaign = campaignResult.rows[0];
		if (!campaign) throw new Error("Campaign not found");

		const suppressedResults = await query('SELECT * FROM "BlacklistedEmail" WHERE email = $1', [lead.email]);

		const emailBodyHTML = campaign.bodyHTML
			.replaceAll("[[firstname]]", email.leadFirstName)
			.replaceAll("[[lastname]]", email.leadLastName)
			.replaceAll("[[email]]", email.leadEmail)
			.replaceAll("[[companyname]]", email.leadCompanyName);

		const footer = `
        <div style="font-size:16px;padding:16px 24px 16px 24px; color: #737373; background-color: #F5F5F5">
            <p style="text-align:center; font-size:12px">
                Copyright (C) ${new Date().getFullYear()} ${campaignOrg.name}. All rights reserved.
            </p>
            <p style="text-align:center; font-size:12px">
                Do not want to receive these mails? Click
                <a href="${process.env.MAIN_APP_BASE_URL}unsubscribe/${lead.id}" style="text-decoration: underline">here</a> to
                unsubscribe.
            </p>
            <p style="text-align:center; padding: 0px 0px 16px 0px; font-size:14px;">
                <a href="https://skyfunnel.ai/" style="text-decoration: underline">SkyFunnel.ai</a>
            </p>
        </div>
        `;

		if (suppressedResults.rows.length > 0) {
			await query('UPDATE "Email" SET status = $1 WHERE id = $2', ['SUPPRESS', email.id]);
			console.log("Suppressed email " + email.id)
			return;
		}

		const emailSent = await sendEmailSES(
			campaign.senderEmail,
			campaign.senderName,
			lead.email,
			campaign.subject,
			emailBodyHTML + footer,
			campaign.replyToEmail,
		);

		if (emailSent.success) {
			const updateEmailResult = query('UPDATE "Email" SET status = $1, "awsMessageId" = $2 WHERE id = $3', ['SENT', emailSent.message.MessageId, email.id]);

			const updateCampaignResult = query('UPDATE "EmailCampaign" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1', [campaign.id]);

			const updateOrganizationResult = query('UPDATE "Organization" SET "sentEmailCount" = "sentEmailCount" + 1 WHERE id = $1', [campaignOrg.id]);

			await Promise.all([updateEmailResult, updateCampaignResult, updateOrganizationResult]);
		} else {
			throw new Error("Email not sent by AWS");
		}
	} catch (error) {
		await query('UPDATE "Email" SET status = $1 WHERE id = $2', ['ERROR', email.id]);
		throw new Error("Error in sendEmail: " + error);
	}
};

const createWorker = async (campaignId: string) => {
	const connection = await getRedisConnection();
	if (!connection) {
		console.error("Redis connection failed");
		return;
	}

	const queueName = `emailQueue-${campaignId}`;

	const worker = new Worker(
		queueName,
		async (job) => {
			const { email, campaignOrg } = job.data;
			await sendEmail(email, campaignOrg);
		},
		{
			limiter: {
				max: 1,
				duration: 1000,
			},
			concurrency: 1,
			connection,
		},
	);

	worker.on("failed", (job, err) => {
		console.error(`Job ${job?.id} failed with ${job?.attemptsMade} attempts: ${err.message}`);
	});

	console.log(`Worker created for queue: ${queueName}`);
};

export async function initializeWorkerForCampaign(campaignId: string) {
	try {
		await createWorker(campaignId);
	} catch (error) {
		console.error(`Failed to initialize worker for campaign ${campaignId}:`, error);
	}
}

export async function addEmailToQueue(email: Email, campaignOrg: CampaignOrg, interval: number, index: number) {
	const connection = await getRedisConnection();
	if (!connection) {
		console.error("Redis connection failed");
		return;
	}
	const queueName = `emailQueue-${email.emailCampaignId}`;
	const emailQueue = new Queue(queueName, { connection });

	// Calculate delay based on the job's index in the batch
	const delay = index * interval * 1000;

	await emailQueue.add(
		email.id,
		{ email, campaignOrg },
		{
			removeOnComplete: true,
			removeOnFail: true,
			attempts: 3, // Total attempts including the first try and two retries
			delay: delay,
			backoff: {
				type: "exponential", // Exponential backoff strategy
				delay: 1000, // Initial delay of 1 second
			},
		},
	);
}

export async function addBulkEmailsToQueue(emails: Email[], campaignOrg: CampaignOrg, interval: number) {
	const connection = await getRedisConnection();
	if (!connection) {
		console.error("Redis connection failed");
		return;
	}

	const queueName = `emailQueue-${emails[0].emailCampaignId}`;
	const emailQueue = new Queue(queueName, { connection });

	const jobs = emails.map((email, index) => {
		const delay = index * interval * 1000;

		return {
			name: email.id,
			data: { email, campaignOrg },
			opts: {
				removeOnComplete: true,
				removeOnFail: true,
				attempts: 3, // Total attempts including the first try and two retries
				delay: delay,
				backoff: {
					type: "exponential", // Exponential backoff strategy
					delay: 1000, // Initial delay of 1 second
				},
			},
		};
	});

	// TODO: uncomment before push
	await emailQueue.addBulk(jobs);
}
