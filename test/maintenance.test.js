const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_ACCESS_SECRET =
  "test-secret-with-at-least-thirty-two-characters";
process.env.CRON_SECRET =
  "test-cron-secret-with-at-least-thirty-two-characters";
// Explicit test-only configuration; every worker call below is mocked.
process.env.SUPABASE_URL = "https://storage.example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  "test-only-storage-key-with-no-provider-access";
process.env.LISTING_IMAGE_BUCKET = "test-images";
const app = require("../src/app");
const { env } = require("../src/config/env");
const db = require("../src/db");
const cleanup = require("../src/modules/catalog/imageCleanupService");
const path = "/api/v1/internal/storage-cleanup";
const authorization = `Bearer ${process.env.CRON_SECRET}`;

test("cleanup rejects anonymous, forged and unconfigured cron credentials before any work", async (t) => {
  const worker = t.mock.method(cleanup, "cleanImageObjects");
  for (const header of [
    "",
    "Bearer wrong",
    authorization + "extra",
    "Bearer " + process.env.JWT_ACCESS_SECRET,
  ]) {
    const response = await request(app).get(path).set("Authorization", header);
    assert.equal(response.status, 401);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  }
  t.mock.property(env, "CRON_SECRET", undefined);
  assert.equal(
    (await request(app).get(path).set("Authorization", authorization)).status,
    401,
  );
  assert.equal(worker.mock.callCount(), 0);
});

test("cleanup refuses HEAD/POST and missing storage before invoking the worker", async (t) => {
  const worker = t.mock.method(cleanup, "cleanImageObjects");
  for (const method of ["head", "post"]) {
    const response = await request(app)
      [method](path)
      .set("Authorization", authorization);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, "GET");
  }
  t.mock.property(env, "SUPABASE_URL", undefined);
  const response = await request(app)
    .get(path)
    .set("Authorization", authorization);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "STORAGE_NOT_CONFIGURED");
  assert.equal(worker.mock.callCount(), 0);
});

test("authenticated cleanup returns counts and logs no credentials or object keys", async (t) => {
  t.mock.property(env, "SUPABASE_URL", "https://storage.example.invalid");
  const result = { queued: 2, removed: 1, failed: 0 };
  const worker = t.mock.method(
    cleanup,
    "cleanImageObjects",
    async () => result,
  );
  const logger = t.mock.method(console, "info", () => {});
  const response = await request(app)
    .get(path)
    .set("Authorization", authorization);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: result });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(worker.mock.callCount(), 1);
  const log = JSON.parse(logger.mock.calls[0].arguments[0]);
  assert.deepEqual(log, {
    level: "info",
    event: "image_cleanup",
    correlationId: response.headers["x-request-id"],
    ...result,
  });
});

test("cleanup signals partial failure and worker errors instead of claiming success", async (t) => {
  t.mock.property(env, "SUPABASE_URL", "https://storage.example.invalid");
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
  const worker = t.mock.method(cleanup, "cleanImageObjects", async () => ({
    queued: 1,
    removed: 0,
    failed: 1,
  }));
  const partial = await request(app)
    .get(path)
    .set("Authorization", authorization);
  assert.equal(partial.status, 503);
  assert.equal(partial.body.error.code, "IMAGE_CLEANUP_INCOMPLETE");
  worker.mock.mockImplementation(async () => {
    throw new Error("private-provider-detail");
  });
  const failure = await request(app)
    .get(path)
    .set("Authorization", authorization);
  assert.equal(failure.status, 500);
  assert.equal(failure.body.error.code, "INTERNAL_ERROR");
  assert.equal(
    JSON.stringify(failure.body).includes("private-provider-detail"),
    false,
  );
});

test.after(() => db.pool.end());
