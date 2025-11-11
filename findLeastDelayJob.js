import Redis from "ioredis";

const redis = new Redis({
  host: "147.182.214.155",
  port: 6379,
  password: "RboMlTyHfoSFcu0SkQcse6aNXeahp0AKjAzCaF5FFPg",
});

async function findLeastDelayJob() {
  const pattern = "*cmhsn6l2n0001lkk4vhf79mgw*";
  const keys = await redis.keys(pattern);

  if (!keys.length) {
    console.log(`No matching jobs found for pattern: ${pattern}`);
    return;
  }

  console.log(`Found ${keys.length} jobs. Scanning in parallel...`);

  let leastDelay = Infinity;
  let leastKey = null;
  let leastTimestamp = null;

  const batchSize = 100;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (key) => {
        const job = await redis.hgetall(key);
        if (!job.delay && !job.opts) return null;

        let delay = 0;
        
        // Prioritize opts.delay over job.delay
        try {
          const opts = JSON.parse(job.opts || "{}");
          delay = Number(opts.delay) || Number(job.delay) || 0;
        } catch {
          delay = Number(job.delay) || 0;
        }

        const timestamp = Number(job.timestamp) || 0;
        return { key, delay, timestamp };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        const { key, delay, timestamp } = r.value;
        if (delay < leastDelay) {
          leastDelay = delay;
          leastKey = key;
          leastTimestamp = timestamp;
        }
      }
    }
  }

  if (!leastKey) {
    console.log("No job with delay found.");
    return;
  }

  const executionTimeUTC = new Date(leastTimestamp + leastDelay);
  const executionTimeIST = new Date(executionTimeUTC.getTime() + 5.5 * 60 * 60 * 1000);

  console.log("\n==================================");
  console.log(`🧩 Job key: ${leastKey}`);
  console.log(`⏱️ Least delay: ${leastDelay.toLocaleString()} ms`);
  console.log(`📅 Timestamp (UTC): ${new Date(leastTimestamp).toISOString()}`);
  console.log(`🚀 Execution Time (UTC): ${executionTimeUTC.toISOString()}`);
  console.log(`🇮🇳 Execution Time (IST): ${executionTimeIST.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
  console.log("==================================");

  await redis.quit();
}

findLeastDelayJob();