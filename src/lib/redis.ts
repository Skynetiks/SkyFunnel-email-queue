import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const MAX_REDIS_RETRIES = 5;
let connection: Redis | null = null;
export async function getRedisConnection() {
  if (process.env.REDIS_URL && !connection) {
    connection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: MAX_REDIS_RETRIES,
      lazyConnect: true,
    });
    connection.on("error", function (err) {
      connection = null;
      console.error("Redis error", err);
    });

    connection.on("ready", function () {
      console.log("Redis is connected successfully");
    });

    connection.on("close", function () {
      console.log("Redis is disconnected");
    });
  }
  return connection;
}
