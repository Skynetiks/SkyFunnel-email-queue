import { getRedisConnection } from "./redis";

const DELAYED_SENDERS_KEY_PREFIX = "delayed_sender:";

/**
 * Utility class to manage delayed senders in Redis
 * When a sender encounters a 550 error, we mark them as delayed
 * to prevent other jobs from the same sender from being processed
 */
export class DelayedSendersManager {
  /**
   * Mark a sender as delayed for a specific duration
   * @param senderEmail - The sender email to mark as delayed
   * @param delayInSeconds - How long to delay (in seconds)
   */
  static async markSenderAsDelayed(senderEmail: string, delayInSeconds: number): Promise<void> {
    const redis = await getRedisConnection();
    if (!redis) {
      console.error("[DELAYED_SENDERS] Redis connection not available");
      return;
    }

    const key = `${DELAYED_SENDERS_KEY_PREFIX}${senderEmail}`;
    const expiryTime = Date.now() + delayInSeconds * 1000;

    // Store the expiry timestamp and set TTL
    await redis.set(key, expiryTime.toString(), "EX", delayInSeconds);
    console.log(`[DELAYED_SENDERS] Marked sender ${senderEmail} as delayed for ${delayInSeconds} seconds`);
  }

  /**
   * Check if a sender is currently delayed
   * @param senderEmail - The sender email to check
   * @returns Object with isDelayed boolean and remaining delay in seconds (if delayed)
   */
  static async isSenderDelayed(senderEmail: string): Promise<{ isDelayed: boolean; remainingDelaySeconds?: number }> {
    const redis = await getRedisConnection();
    if (!redis) {
      console.error("[DELAYED_SENDERS] Redis connection not available");
      return { isDelayed: false };
    }

    const key = `${DELAYED_SENDERS_KEY_PREFIX}${senderEmail}`;
    const expiryTime = await redis.get(key);

    if (!expiryTime) {
      return { isDelayed: false };
    }

    const now = Date.now();
    const expiryTimestamp = parseInt(expiryTime, 10);
    const remainingMs = expiryTimestamp - now;

    if (remainingMs <= 0) {
      // Expired, clean up
      await redis.del(key);
      return { isDelayed: false };
    }

    return {
      isDelayed: true,
      remainingDelaySeconds: Math.ceil(remainingMs / 1000),
    };
  }

  /**
   * Remove the delay for a sender (if needed for manual intervention)
   * @param senderEmail - The sender email to unmark
   */
  static async removeSenderDelay(senderEmail: string): Promise<void> {
    const redis = await getRedisConnection();
    if (!redis) {
      console.error("[DELAYED_SENDERS] Redis connection not available");
      return;
    }

    const key = `${DELAYED_SENDERS_KEY_PREFIX}${senderEmail}`;
    await redis.del(key);
    console.log(`[DELAYED_SENDERS] Removed delay for sender ${senderEmail}`);
  }
}
