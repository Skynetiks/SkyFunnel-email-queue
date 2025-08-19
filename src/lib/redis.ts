import { Redis } from "ioredis";
import dotenv from "dotenv";
import Redlock from "redlock";
import { Debug } from "./debug";

dotenv.config();

const MAX_REDIS_RETRIES = 3;
const REDIS_LOG_PREFIX = "[REDIS]";

const REDIS_RETRY_MIN_DELAY = parseInt(process.env.REDIS_RETRY_MIN_DELAY || "1000", 10); // ms
const REDIS_RETRY_MAX_DELAY = parseInt(process.env.REDIS_RETRY_MAX_DELAY || "20000", 10); // ms

let redisClient: Redis | null = null;
let redlockInstance: Redlock | null = null;

export async function getRedisConnection(): Promise<Redis> {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not defined in environment variables");
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: MAX_REDIS_RETRIES,
    lazyConnect: true,
    retryStrategy: (attempt: number) => {
      const delay = Math.max(Math.min(Math.pow(2, attempt) * 100, REDIS_RETRY_MAX_DELAY), REDIS_RETRY_MIN_DELAY);
      return delay;
    },
  });

  redisClient.on("ready", () => Debug.log(`${REDIS_LOG_PREFIX} Connected`));
  redisClient.on("error", (err) => Debug.error(`${REDIS_LOG_PREFIX} Error`, err));
  redisClient.on("close", () => Debug.log(`${REDIS_LOG_PREFIX} Disconnected`));

  try {
    await redisClient.connect();
  } catch (err) {
    Debug.error(`${REDIS_LOG_PREFIX} Failed to connect`, err);
    throw err;
  }

  return redisClient;
}

export async function getRedLock(): Promise<Redlock> {
  if (redlockInstance) return redlockInstance;

  const redis = await getRedisConnection();

  redlockInstance = new Redlock([redis], {
    retryCount: MAX_REDIS_RETRIES,
    retryDelay: 200, // ms between attempts
    retryJitter: 100, // random variation up to this amount
  });

  redlockInstance.on("error", (err) => Debug.error("[LOCK] Skipping email send for org due to lock contention.", err));

  return redlockInstance;
}
