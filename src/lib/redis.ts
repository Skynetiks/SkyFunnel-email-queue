import { Redis } from "ioredis";
import dotenv from "dotenv";

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
    });

    connection.on("error", (err) => {
      console.error("Redis error", err);
    });

    connection.on("ready", () => {
      console.log("Redis is connected successfully");
    });

    connection.on("close", () => {
      console.log("Redis is disconnected");
    });
  }
  return connection;
}
