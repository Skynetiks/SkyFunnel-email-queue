import pg from "pg";
import dotenv from "dotenv";
import { Debug, isDevelopment } from "./utils";
import fs from "fs"

const { Pool } = pg;
dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const sslOptions = !isDevelopment
  ? {
      ca: fs.readFileSync("/etc/ssl/certs/ca-certificates.crt"),
    }
  : { rejectUnauthorized: false };

let pool: pg.Pool | undefined;

export function getPool() {
  if (!pool) {
    Debug.log("Creating a new database pool");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOptions,
      // PgBouncer optimized settings
      max: 10, // Much lower for PgBouncer - it handles the actual pooling
      min: 0, // No minimum connections needed with PgBouncer
      idleTimeoutMillis: 30000, // 30 seconds - shorter since PgBouncer manages connections
      connectionTimeoutMillis: 10000, // 10 seconds - faster timeout for PgBouncer
      query_timeout: 30000, // 30 seconds query timeout
      // Disable session-level features that don't work well with PgBouncer
      application_name: "skyfunnel-email-service",
    });
  }
  return pool;
}

getPool();
export const query = async (text: string, params: (string | number)[]) => {
  const start = Date.now();
  let client;
  try {
    client = await getPool().connect(); // Acquire client
    if (!client) {
      throw new Error("Database pool is not initialized");
    }
    const result = await client.query(text, params);
    const duration = Date.now() - start;
    Debug.log(`[DB] Query executed in ${duration / 1000} seconds`, text);
    return result;
  } catch (error) {
    Debug.error("Query execution failed:", error);
    // Log pool status for debugging
    const pool = getPool();
    Debug.error(`[DB] Pool status - total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);
    throw error;
  } finally {
    if (client) {
      client.release(); // Always release the client
    }
  }
};

export default pool;

process.on("SIGINT", async () => {
  if (pool && pool.ended === false) {
    Debug.log("Closing database pool...");
    await pool.end();
    Debug.log("Database pool closed");
  }
  process.exit(0);
});
