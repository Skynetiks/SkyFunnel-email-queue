import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isDevelopment } from "./utils";

const { Pool } = pg;
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sslOptions = !isDevelopment
  ? {
      ca: fs.readFileSync(path.resolve(__dirname, "./certs/us-east-1-bundle.pem")),
    }
  : undefined;

let pool: pg.Pool | undefined;

export function getPool() {
  if (!pool) {
    console.log("Creating new pool");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOptions,
      idleTimeoutMillis: 30000, // 30 seconds
      max: 100, // Maximum concurrent connections
    });
  }
  return pool;
}

getPool();
export const query = async (text: string, params: (string | number)[]) => {
  const activePool = await getPool().connect(); // Acquire client
  try {
    if (!activePool) {
      throw new Error("Database pool is not initialized");
    }
    const result = await activePool.query(text, params);
    return result;
  } catch (error) {
    console.error("Query execution failed:", error);
    throw error;
  } finally {
    activePool.release(); // Always release the client
  }
};

export default pool;

process.on("SIGINT", async () => {
  if (pool) {
    console.log("Closing database pool...");
    await pool.end();
    console.log("Database pool closed");
  }
  process.exit(0);
});
