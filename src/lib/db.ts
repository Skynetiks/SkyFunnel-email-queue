import pg from "pg";
import dotenv from "dotenv";
import { isDevelopment } from "./utils";
import { Debug } from "./debug";

const { Pool } = pg;
dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

if (isDevelopment) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const sslOptions = !isDevelopment
  ? {
      rejectUnauthorized: true,
    }
  : { rejectUnauthorized: false };

let pool: pg.Pool | undefined;

export function getPool() {
  if (!pool) {
    Debug.log("Creating a new database pool");

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOptions,
      // Conservative settings for PgBouncer with network issues
      max: 5, // Very conservative limit
      min: 0,
      idleTimeoutMillis: 10000, // 10 seconds - aggressive cleanup
      connectionTimeoutMillis: 15000, // 15 seconds - longer for network issues
      query_timeout: 60000, // 60 seconds - longer for heavy queries
      keepAlive: true, // Keep connections alive
      keepAliveInitialDelayMillis: 10000,
      application_name: "skyfunnel-email-service",
    });

    // Add comprehensive error handling
    pool.on("error", (err) => {
      Debug.error("Database pool error:", err);
    });

    pool.on("connect", () => {
      Debug.log("New database client connected");
    });

    pool.on("remove", () => {
      Debug.log("Database client removed from pool");
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

    // Log connection string (without password) for debugging
    const dbUrl = process.env.DATABASE_URL || "";
    const sanitizedUrl = dbUrl.replace(/:[^:@]*@/, ":***@");
    Debug.error(`[DB] Connection string: ${sanitizedUrl}`);

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
