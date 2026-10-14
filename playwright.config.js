const path = require("node:path");
const { defineConfig } = require("@playwright/test");
const database = new URL(
  process.env.TEST_DATABASE_URL || "postgresql://invalid/invalid",
);
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.startsWith("/resourcepk_test_")
)
  throw new Error(
    "Browser tests require an isolated local resourcepk_test_* database",
  );
if (!process.env.E2E_PASSWORD)
  throw new Error("Set E2E_PASSWORD for the opt-in demo accounts");
const frontend =
  process.env.E2E_FRONTEND_DIR || path.resolve(__dirname, "../frontend");
module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npm start",
      url: "http://localhost:5000/health",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: database.toString(),
        APP_URL: "http://localhost:3000",
        CORS_ORIGINS: "http://localhost:3000",
      },
    },
    {
      command: "npm run preview -- --host 0.0.0.0 --port 3000 --strictPort",
      cwd: frontend,
      url: "http://localhost:3000",
      reuseExistingServer: false,
    },
  ],
});
