const app = require("./app");
const { env } = require("./config/env");
const { pool } = require("./db");

const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing connections`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
