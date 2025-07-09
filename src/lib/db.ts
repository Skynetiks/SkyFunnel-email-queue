import pg from "pg";
import dotenv from "dotenv";
import { Debug } from "./utils";

const { Pool } = pg;
dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const sslOptions = !isDevelopment
//   ? {
//       ca: fs.readFileSync(path.resolve(__dirname, "./certs/us-east-1-bundle.pem")),
//     }
//   : { rejectUnauthorized: false };

let pool: pg.Pool | undefined;

export function getPool() {
  if (!pool) {
    Debug.log("Creating a new database pool");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // ssl: process.env.NODE_ENV === "production" ? sslOptions : false,
      idleTimeoutMillis: 30000, // 30 seconds
      max: 100, // Maximum concurrent connections
    });
  }
  return pool;
}

getPool();
export const query = async (text: string, params: (string | number)[]) => {
  const start = Date.now();
  const activePool = await getPool().connect(); // Acquire client
  try {
    if (!activePool) {
      throw new Error("Database pool is not initialized");
    }
    const result = await activePool.query(text, params);
    const duration = Date.now() - start;
    Debug.log(`[DB] Query executed in ${duration / 1000} seconds`, text);
    return result;
  } catch (error) {
    Debug.error("Query execution failed:", error);
    throw error;
  } finally {
    activePool.release(); // Always release the client
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
