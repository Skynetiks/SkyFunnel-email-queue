import { Redis } from "ioredis";
import dotenv from "dotenv";
import { Debug } from "./utils";

dotenv.config();

const MAX_REDIS_RETRIES = 5;
let connection: Redis | null = null;

export async function getRedisConnection() {
  if (!connection) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is not defined in environment variables");
    }

    connection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: MAX_REDIS_RETRIES,
      lazyConnect: true,
      retryStrategy: function (times: number) {
        return Math.max(Math.min(Math.exp(times), 20000), 1000);
      },
    });

    connection.on("error", (err) => {
      Debug.error("Redis error", err);
    });

    connection.on("ready", () => {
      Debug.log("Redis is connected successfully");
    });

    connection.on("close", () => {
      Debug.log("Redis is disconnected");
    });
  }
  return connection;
}
