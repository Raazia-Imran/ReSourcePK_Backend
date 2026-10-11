const { Pool } = require("pg");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
async function prepare() {
  const url = new URL(
    process.env.TEST_DATABASE_URL || "postgresql://invalid/invalid",
  );
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.startsWith("/resourcepk_test_")
  )
    throw new Error("Use a dedicated local resourcepk_test_* database");
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await pool.query(
      "DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    );
  } finally {
    await pool.end();
  }
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../src/db/migrate.js")],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test" },
    },
  );
  if (result.status !== 0) throw new Error("Test migration failed");
}
prepare().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
