const { Pool } = require("pg");
const { env } = require("../config/env");

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl:
    env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: env.NODE_ENV === "test" ? 2 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "postgres_pool_error",
      message: error.message,
    }),
  );
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
