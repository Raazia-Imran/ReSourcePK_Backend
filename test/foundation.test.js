const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_ACCESS_SECRET ||=
  "test-secret-with-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";

test("one-time tokens are random and only their digest is stable", async () => {
  const { randomToken, hashToken } = require("../src/lib/tokens");
  const first = randomToken();
  const second = randomToken();
  assert.notEqual(first, second);
  assert.equal(hashToken(first), hashToken(first));
  assert.equal(hashToken(first).length, 64);
});

test("transactional emails include text and accessible HTML actions", () => {
  const {
    verificationEmail,
    passwordResetEmail,
  } = require("../src/email/templates");
  for (const message of [
    verificationEmail({
      name: "A & B",
      url: "https://example.test/verify?t=1",
    }),
    passwordResetEmail({ name: "A", url: "https://example.test/reset?t=1" }),
  ]) {
    assert.match(message.text, /https:\/\//);
    assert.match(message.html, /lang="en"/);
    assert.match(message.html, /<a href=/);
  }
});

test("health endpoint responds without exposing internals", async () => {
  const request = require("supertest");
  const app = require("../src/app");
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("registration reports actionable password errors without querying database", async () => {
  const request = require("supertest");
  const app = require("../src/app");
  const response = await request(app).post("/api/v1/auth/register").send({
    accountType: "seller",
    fullName: "Test Seller",
    organizationName: "Test Mill",
    email: "owner@example.com",
    password: "short",
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.password.length);
});

test("listing mutation requires sign-in and rejects malformed IDs", async () => {
  const request = require("supertest");
  const app = require("../src/app");
  const response = await request(app)
    .post("/api/v1/organizations/00000000-0000-4000-8000-000000000001/listings")
    .send({ title: "test" });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
  const malformed = await request(app).get("/api/v1/listings/not-an-id");
  assert.equal(malformed.status, 422);
});

test("an anonymous visitor cannot create a seller organization", async () => {
  const request = require("supertest");
  const response = await request(require("../src/app"))
    .post("/api/v1/organizations")
    .send({ name: "Example Mill" });
  assert.equal(response.status, 401);
});

test.after(async () => {
  const { pool } = require("../src/db");
  await pool.end();
});
