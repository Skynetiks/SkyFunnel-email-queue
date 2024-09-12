import { Queue } from "bullmq";

import { getRedisConnection } from "./redis";
import { EmailData } from "./types";

export async function getEmailQueue() {
	const connection = await getRedisConnection();
	if (!connection) {
		throw new Error('Redis connection not available');
	}

	const EmailQueue = new Queue('email-queue', {
		connection,
	});

	console.log('Email queue created');

	return EmailQueue;
}

export async function addEmailsToQueue(emails: EmailData[]) {
	const EmailQueue = await getEmailQueue();
	console.log('Adding emails to queue');

	const payload = emails.map((email, i) => ({
		name: `send-email-${i}`,
		data: email,
		opts: {
			removeOnComplete: true,
			removeOnFail: true,
			attempts: 3,
			delay: 2000,
			backoff: {
				type: "exponential",
				delay: 1000,
			},
		},
	}));

	const res = await EmailQueue.addBulk(payload);

	console.log(res);

	return res;
}
