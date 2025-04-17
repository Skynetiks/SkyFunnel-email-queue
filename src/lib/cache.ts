import { getRedisConnection } from "./redis";
import { Debug } from "./utils";

export const cache = async <T>(key: string, fn: () => Promise<T>, ttl: number = 3600): Promise<T> => {
  // Try to get cached data
  const redis = await getRedisConnection();
  const cachedData = await redis.get(key);
  if (cachedData) {
    Debug.devLog(`[CACHE] Cache hit for key ${key}`);
    return JSON.parse(cachedData);
  }

  Debug.devLog(`[CACHE] Cache miss for key ${key}`);
  // Fetch fresh data
  const data = await fn();

  // Store in Redis if data is not null/undefined
  if (data !== null && data !== undefined) {
    await redis.set(key, JSON.stringify(data), "EX", ttl);
  }

  return data;
};

export const deleteCache = async (key: string) => {
  const redis = await getRedisConnection();
  await redis.del(key);
};
