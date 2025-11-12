import Redis from "ioredis";
import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "";
const SMTP_EMAIL_QUEUE_KEY = "SMTP_EMAIL_SENDING_QUEUE";

const redis = new Redis(REDIS_URL);

// Create BullMQ queue instance (same as your application)
const queue = new Queue(SMTP_EMAIL_QUEUE_KEY, {
  connection: {
    url: REDIS_URL,
  },
});

interface JobData {
  email: {
    id: string;
    emailCampaignId: string;
    email?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  campaignOrg: {
    id: string;
    name: string;
  };
  actualInterval?: number;
}

interface JobInfo {
  key: string;
  jobId: string;
  timestamp: number;
  delay: number;
  expectedExecutionTime: number;
  data: JobData;
}

async function fixStuckJobs() {
  console.log("🔍 Scanning for stuck jobs...\n");

  // BullMQ uses a different key pattern
  const pattern = `*cmhsn6l2n0001lkk4vhf79mgw*`;
  const keys = await redis.keys(pattern);

  // Filter only job keys (not meta keys)
  const jobKeys = keys.filter(key => {
    const parts = key.split(":");
    return parts.length >= 3 && !["meta", "events", "wait", "active", "completed", "failed", "delayed", "paused", "id"].includes(parts[2]);
  });

  if (!jobKeys.length) {
    console.log("No jobs found.");
    await cleanup();
    return;
  }

  console.log(`Found ${jobKeys.length} total jobs. Checking which are stuck...\n`);

  const now = Date.now();
  const stuckJobs: JobInfo[] = [];

  // Check each job in batches
  const batchSize = 100;
  for (let i = 0; i < jobKeys.length; i += batchSize) {
    const batch = jobKeys.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (key) => {
        const job = await redis.hgetall(key);
        
        if (!job.timestamp || !job.opts) return null;

        const timestamp = Number(job.timestamp);
        let delay = 0;

        try {
          const opts = JSON.parse(job.opts);
          delay = Number(opts.delay) || Number(job.delay) || 0;
        } catch {
          delay = Number(job.delay) || 0;
        }

        const expectedExecutionTime = timestamp + delay;

        // If job should have executed more than 1 minute ago, it's stuck
        if (expectedExecutionTime < now - 60000) {
          let data: JobData;
          try {
            data = JSON.parse(job.data);
          } catch {
            console.warn(`⚠️  Could not parse data for ${key}`);
            return null;
          }

          const opts = JSON.parse(job.opts);
          return {
            key,
            jobId: opts.jobId || key.split(":").pop() || "",
            timestamp,
            delay,
            expectedExecutionTime,
            data,
          };
        }

        return null;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        stuckJobs.push(r.value);
      }
    }
  }

  if (!stuckJobs.length) {
    console.log("✅ No stuck jobs found. All jobs are on schedule!");
    await cleanup();
    return;
  }

  console.log(`⚠️  Found ${stuckJobs.length} stuck jobs\n`);

  // Display stuck jobs summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("STUCK JOBS SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  
  stuckJobs.slice(0, 5).forEach((job, index) => {
    const expectedTime = new Date(job.expectedExecutionTime);
    const overdueMs = now - job.expectedExecutionTime;
    const overdueHours = (overdueMs / (1000 * 60 * 60)).toFixed(2);
    
    console.log(`\n${index + 1}. Job ID: ${job.jobId}`);
    console.log(`   Email: ${job.data.email.email || 'N/A'}`);
    console.log(`   Expected execution: ${expectedTime.toISOString()}`);
    console.log(`   Overdue by: ${overdueHours} hours`);
  });

  if (stuckJobs.length > 5) {
    console.log(`\n... and ${stuckJobs.length - 5} more stuck jobs`);
  }

  console.log("\n═══════════════════════════════════════════════════════════\n");
  console.log("🔧 Starting fix process...\n");

  let successCount = 0;
  let failCount = 0;

  // Process jobs one by one with 15 second delay between each
  const DELAY_BETWEEN_JOBS_MS = 15000; // 15 seconds
  
  for (let i = 0; i < stuckJobs.length; i++) {
    const job = stuckJobs[i];
    const delayMs = i * DELAY_BETWEEN_JOBS_MS;
    const executeAt = new Date(Date.now() + delayMs);
    
    console.log(`Processing job ${i + 1}/${stuckJobs.length} - Email: ${job.data.email.email || 'N/A'}`);
    console.log(`   Will execute at: ${executeAt.toISOString()} (in ${delayMs / 1000} seconds)`);

    try {
      // Remove the old stuck job
      try {
        const oldJob = await queue.getJob(job.jobId);
        if (oldJob) {
          await oldJob.remove();
          console.log(`   🗑️  Removed old job: ${job.jobId}`);
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // Job might not exist in BullMQ, try Redis cleanup
        await redis.del(job.key);
        console.log(`   🗑️  Cleaned up Redis key: ${job.key}`);
      }
      
      // Add new job using BullMQ's queue.add() method with proper delay
      const newJobId = `${job.jobId}-recovery-${Date.now()}-${i}`;
      
      await queue.add(
        job.data.email.id, // job name
        job.data, // job data
        {
          jobId: newJobId,
          priority: 10,
          delay: delayMs, // BullMQ handles this properly
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        }
      );

      successCount++;
      console.log(`   ✅ Created new job: ${newJobId}`);
    } catch (error) {
      failCount++;
      console.error(`   ❌ Failed to fix job ${job.jobId}:`, error);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("FIX COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`✅ Successfully fixed: ${successCount} jobs`);
  console.log(`❌ Failed to fix: ${failCount} jobs`);
  console.log(`📊 Total processed: ${stuckJobs.length} jobs`);
  console.log(`\n⏱️  Jobs are scheduled with ${DELAY_BETWEEN_JOBS_MS / 1000}-second intervals between each.`);
  console.log(`   First job executes immediately, last job in ~${(stuckJobs.length * DELAY_BETWEEN_JOBS_MS / 1000 / 60).toFixed(1)} minutes.`);
  console.log(`   Your worker will process them automatically.\n`);

  await cleanup();
}

async function cleanup() {
  await queue.close();
  await redis.quit();
}

// Run the script
fixStuckJobs().catch((error) => {
  console.error("Fatal error:", error);
  cleanup().then(() => process.exit(1));
});