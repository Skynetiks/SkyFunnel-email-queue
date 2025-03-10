import Redis from "ioredis";
import { getRedisConnection } from "./redis";
import { getOrganizationById } from "../db/emailQueries";

export class RedisUsageStore {
  private static instance: RedisUsageStore;
  private redisClient!: Redis;
  // Internal promise that resolves once the Redis client is connected.
  private ready: Promise<void>;

  // Private constructor that initiates the connection.
  private constructor() {
    this.ready = getRedisConnection().then((client) => {
      this.redisClient = client;
    });
  }

  /**
   * Retrieves the singleton instance.
   * The instance is created eagerly if it doesn't already exist.
   */
  public static getInstance(): RedisUsageStore {
    if (!RedisUsageStore.instance) {
      RedisUsageStore.instance = new RedisUsageStore();
    }
    return RedisUsageStore.instance;
  }

  /**
   * Generates a Redis key based on the organization ID.
   */
  static getKey(organizationId: string): string {
    return `usage:${organizationId}`;
  }

  /**
   * Retrieves the current usage as a number (defaults to 0 if not set).
   */
  async getUsage(organizationId: string): Promise<number> {
    await this.ready;
    const key = RedisUsageStore.getKey(organizationId);
    const usageString = await this.redisClient.get(key);

    if (!usageString) {
      const usage = await getOrganizationById(organizationId);
      if (usage) {
        await this.setUsage(organizationId, usage.sentEmailCount);
        return usage.sentEmailCount;
      }
    }

    return usageString ? parseInt(usageString, 10) : 0;
  }

  /**
   * Increments the usage counter by a specified amount (defaults to 1)
   * and returns the new total.
   */
  async incrementUsage(organizationId: string, usage: number = 1): Promise<number> {
    await this.ready;
    const key = RedisUsageStore.getKey(organizationId);
    return await this.redisClient.incrby(key, usage);
  }

  /**
   * Sets the usage counter to a specific number.
   */
  async setUsage(organizationId: string, usage: number): Promise<"OK"> {
    await this.ready;
    const key = RedisUsageStore.getKey(organizationId);
    return await this.redisClient.set(key, usage);
  }
}

// Export the singleton instance (synchronously available)
export const usageRedisStore = RedisUsageStore.getInstance();
