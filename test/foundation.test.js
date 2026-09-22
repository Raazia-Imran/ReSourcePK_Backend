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

test.after(async () => {
  const { pool } = require("../src/db");
  await pool.end();
});
