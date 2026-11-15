const test = require("node:test");
const assert = require("node:assert/strict");
const {
  linkApprovedGoogleAccount,
} = require("../src/services/googleLinkApproval");
const user = {
  id: "user-1",
  email: "owner@gmail.com",
  status: "active",
  email_verified_at: new Date(),
};
const profile = {
  email: user.email,
  subject: "verified-subject",
  emailAuthoritative: true,
};
const config = {
  GOOGLE_LINK_APPROVAL_EMAIL: user.email,
  GOOGLE_LINK_APPROVAL_EXPIRES_AT: "2026-11-16T00:00:00Z",
};
const now = Date.parse("2026-11-15T00:00:00Z");
test("approved verified Google identity links the existing account and records an audit event", async () => {
  const calls = [];
  const runner = {
    query: async (...args) => {
      calls.push(args);
      return { rowCount: 0 };
    },
  };
  assert.equal(
    await linkApprovedGoogleAccount(
      runner,
      user,
      profile,
      { ip: "127.0.0.1" },
      config,
      now,
    ),
    user,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1][1], [user.id, profile.subject]);
  assert.match(calls[2][0], /google_linked_recovery/);
});
test("missing, expired, mismatched and unverified approvals never write", async () => {
  for (const [u, p, c] of [
    [user, profile, {}],
    [
      user,
      profile,
      { ...config, GOOGLE_LINK_APPROVAL_EXPIRES_AT: "2026-11-14T00:00:00Z" },
    ],
    [user, { ...profile, email: "other@gmail.com" }, config],
    [user, { ...profile, emailAuthoritative: false }, config],
    [{ ...user, status: "suspended" }, profile, config],
    [{ ...user, email_verified_at: null }, profile, config],
  ]) {
    const runner = {
      query: async () => {
        throw new Error("Unexpected database access");
      },
    };
    assert.equal(
      await linkApprovedGoogleAccount(runner, u, p, {}, c, now),
      null,
    );
  }
});
test("an existing Google link cannot be replaced", async () => {
  let calls = 0;
  const runner = {
    query: async () => {
      calls++;
      return { rowCount: 1 };
    },
  };
  assert.equal(
    await linkApprovedGoogleAccount(runner, user, profile, {}, config, now),
    null,
  );
  assert.equal(calls, 1);
});
