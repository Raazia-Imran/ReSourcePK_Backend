const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_ACCESS_SECRET =
  "test-secret-with-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";
const app = require("../src/app");
const db = require("../src/db");
const { signAccessToken } = require("../src/lib/tokens");
const user = "00000000-0000-4000-8000-000000000001",
  session = "00000000-0000-4000-8000-000000000002";
test("legacy tokens without a session and unexpected token algorithms cannot authenticate", async () => {
  const jwt = require("jsonwebtoken");
  const badAlgorithm = jwt.sign(
    { sub: user, sid: session, type: "access" },
    process.env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS384",
      issuer: "resource-pk-api",
      audience: "resource-pk-web",
    },
  );
  for (const token of [signAccessToken({ id: user }), badAlgorithm]) {
    const response = await request(app)
      .get("/api/v1/requirements")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 401);
  }
});
test("revoked, expired, suspended or unverified sessions fail before the protected handler", async (t) => {
  const calls = [];
  t.mock.method(db, "query", async (sql, args) => {
    calls.push({ sql, args });
    return { rowCount: 0, rows: [] };
  });
  const response = await request(app)
    .get("/api/v1/requirements")
    .set("Authorization", `Bearer ${signAccessToken({ id: user }, session)}`);
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [session, user]);
  assert.match(calls[0].sql, /revoked_at IS NULL/);
  assert.match(calls[0].sql, /email_verified_at IS NOT NULL/);
  assert.match(calls[0].sql, /u.status='active'/);
});
test("valid session reaches protected handler with buyer-scoped identity", async (t) => {
  const calls = [];
  t.mock.method(db, "query", async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes("app.sessions")) return { rowCount: 1, rows: [{}] };
    if (sql.includes("count(*)")) return { rowCount: 1, rows: [{ total: 0 }] };
    return { rowCount: 0, rows: [] };
  });
  t.mock.method(db, "transaction", async (work) => work(db));
  const response = await request(app)
    .get("/api/v1/requirements?page=1&limit=10")
    .set("Authorization", `Bearer ${signAccessToken({ id: user }, session)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, {
    items: [],
    total: 0,
    page: 1,
    limit: 10,
  });
  const scoped = calls.filter(({ sql }) =>
    sql.includes("app.buyer_requirements"),
  );
  assert.equal(scoped.length, 2);
  for (const call of scoped) assert.equal(call.args[0], user);
  assert.deepEqual(scoped[1].args, [user, 10, 0]);
});
test("cookie mutations reject browser forms, missing origins and untrusted origins", async () => {
  for (const path of ["refresh", "logout"]) {
    const response = await request(app)
      .post(`/api/v1/auth/${path}`)
      .set("Origin", "http://localhost:3000");
    assert.equal(response.status, 403);
    const missingOrigin = await request(app)
      .post(`/api/v1/auth/${path}`)
      .set("X-ReSourcePK-CSRF", "1");
    assert.equal(missingOrigin.status, 403);
    const untrusted = await request(app)
      .post(`/api/v1/auth/${path}`)
      .set("X-ReSourcePK-CSRF", "1")
      .set("Origin", "https://untrusted.example");
    assert.equal(untrusted.status, 403);
  }
  const refresh = await request(app)
    .post("/api/v1/auth/refresh")
    .set("X-ReSourcePK-CSRF", "1")
    .set("Origin", "http://localhost:3000");
  assert.equal(refresh.status, 401);
});
test("new passwords beyond bcrypt byte limits and injected privileged registration fields are rejected", async () => {
  const body = {
    accountType: "buyer",
    fullName: "Test Buyer",
    email: "buyer@example.invalid",
    password: "Ab1" + "é".repeat(36),
  };
  const tooLong = await request(app).post("/api/v1/auth/register").send(body);
  assert.equal(tooLong.status, 422);
  const privileged = await request(app)
    .post("/api/v1/auth/register")
    .send({
      ...body,
      password: "ValidPassword123",
      platformRole: "platform_admin",
    });
  assert.equal(privileged.status, 422);
});
test.after(() => db.pool.end());
