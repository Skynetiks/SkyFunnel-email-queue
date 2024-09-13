import { Worker } from 'bullmq';
import dotenv from "dotenv";

import { getRedisConnection } from './redis';
import { handleJob } from './admin-sendmail';

dotenv.config();

export async function initializeWorker() {
	const connection = await getRedisConnection();
	if (!connection) {
		throw new Error('Redis connection not available');
	}

	console.log("Initializing worker");

	const worker = new Worker('email-queue', async job => {
		handleJob(job.data);

		return job.data;
	}, {
		connection,
	});

	console.log("Worker initialized");

	worker.on('completed', job => {
		console.log(`Job completed with result ${job.returnvalue}`);
	});

	worker.on('failed', (job, err) => {
		console.log(`Job failed with error ${err.message}`);
	});
}

initializeWorker();
