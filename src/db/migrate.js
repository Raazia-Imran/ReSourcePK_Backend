const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./index");

async function migrate() {
  const directory = path.resolve(__dirname, "../../migrations");
  const files = (await fs.readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS app");
    await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const applied = new Set(
      (await client.query("SELECT name FROM app.schema_migrations")).rows.map(
        (row) => row.name,
      ),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO app.schema_migrations(name) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
