const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");
const { randomToken, hashToken, signAccessToken } = require("../lib/tokens");
const { verificationEmail, passwordResetEmail } = require("../email/templates");
const { deliverEmail } = require("../email/deliveryService");

const BCRYPT_ROUNDS = 12;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function refreshExpiry() {
  return new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
}

async function loadContext(userId, runner = { query }) {
  const userResult = await runner.query(
    `SELECT id, email, full_name, status, email_verified_at, created_at
     FROM app.users WHERE id = $1`,
    [userId],
  );
  if (!userResult.rowCount)
    throw new AppError(401, "UNAUTHORIZED", "Account not found");

  const [memberships, platformRoles] = await Promise.all([
    runner.query(
      `SELECT m.organization_id, o.name AS organization_name, o.slug, m.role, m.can_invite_staff
       FROM app.organization_memberships m
       JOIN app.organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.name`,
      [userId],
    ),
    runner.query(
      "SELECT role FROM app.platform_assignments WHERE user_id = $1",
      [userId],
    ),
  ]);
  return {
    user: userResult.rows[0],
    memberships: memberships.rows,
    platformRoles: platformRoles.rows.map((row) => row.role),
  };
}

async function createSession(user, meta, runner = { query }) {
  const refreshToken = randomToken();
  await runner.query(
    `INSERT INTO app.sessions(user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      user.id,
      hashToken(refreshToken),
      meta.userAgent,
      meta.ip,
      refreshExpiry(),
    ],
  );
  return { accessToken: signAccessToken(user), refreshToken };
}

async function createEmailToken(userId, type, ttlMs, runner = { query }) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const result = await runner.query(
    `INSERT INTO app.email_tokens(user_id, type, token_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, type, tokenHash, new Date(Date.now() + ttlMs)],
  );
  return { token, id: result.rows[0].id };
}

async function register(input, meta) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  let verification;
  let created;
  try {
    created = await transaction(async (client) => {
      const users = await client.query(
        `INSERT INTO app.users(email, full_name, password_hash)
         VALUES ($1, $2, $3) RETURNING id, email, full_name, status, created_at`,
        [email, input.fullName.trim(), passwordHash],
      );
      const user = users.rows[0];
      if (input.accountType === "seller") {
        const baseSlug = slugify(input.organizationName);
        const slug = `${baseSlug}-${user.id.slice(0, 6)}`;
        const organizations = await client.query(
          `INSERT INTO app.organizations(name, slug, created_by)
           VALUES ($1, $2, $3) RETURNING id, name, slug`,
          [input.organizationName.trim(), slug, user.id],
        );
        await client.query(
          `INSERT INTO app.organization_memberships(organization_id, user_id, role, can_invite_staff)
           VALUES ($1, $2, 'owner', TRUE)`,
          [organizations.rows[0].id, user.id],
        );
      }
      verification = await createEmailToken(
        user.id,
        "verify_email",
        24 * 60 * 60 * 1000,
        client,
      );
      await client.query(
        `INSERT INTO app.audit_events(actor_id, action, resource_type, resource_id, ip_address)
         VALUES ($1, 'account.registered', 'user', $1, $2)`,
        [user.id, meta.ip],
      );
      return user;
    });
  } catch (error) {
    if (error.code === "23505")
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "An account already exists for this email",
      );
    throw error;
  }

  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(verification.token)}`;
  let emailDelivery = "sent";
  try {
    await deliverEmail({
      eventKey: `verify-email:${verification.id}`,
      recipient: created.email,
      template: "verify_email",
      message: verificationEmail({ name: created.full_name, url }),
    });
  } catch {
    emailDelivery = "pending";
  }
  return { id: created.id, email: created.email, emailDelivery };
}

async function resendVerification(email) {
  const result = await query(
    "SELECT id, email, full_name FROM app.users WHERE email = $1 AND email_verified_at IS NULL AND status = 'pending'",
    [email.trim().toLowerCase()],
  );
  if (!result.rowCount) return;
  const user = result.rows[0];
  await query(
    "UPDATE app.email_tokens SET used_at = NOW() WHERE user_id = $1 AND type = 'verify_email' AND used_at IS NULL",
    [user.id],
  );
  const verification = await createEmailToken(
    user.id,
    "verify_email",
    24 * 60 * 60 * 1000,
  );
  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(verification.token)}`;
  await deliverEmail({
    eventKey: `verify-email:${verification.id}`,
    recipient: user.email,
    template: "verify_email",
    message: verificationEmail({ name: user.full_name, url }),
  }).catch(() => undefined);
}

async function verifyEmail(token, meta) {
  return transaction(async (client) => {
    const tokens = await client.query(
      `SELECT id, user_id FROM app.email_tokens
       WHERE token_hash = $1 AND type = 'verify_email' AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token)],
    );
    if (!tokens.rowCount)
      throw new AppError(
        400,
        "INVALID_OR_EXPIRED_TOKEN",
        "Verification link is invalid or expired",
      );
    const record = tokens.rows[0];
    await client.query(
      "UPDATE app.email_tokens SET used_at = NOW() WHERE id = $1",
      [record.id],
    );
    await client.query(
      `UPDATE app.users SET status = 'active', email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`,
      [record.user_id],
    );
    await client.query(
      `INSERT INTO app.audit_events(actor_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'account.email_verified', 'user', $1, $2)`,
      [record.user_id, meta.ip],
    );
    return { verified: true };
  });
}

async function login(input, meta) {
  const result = await query("SELECT * FROM app.users WHERE email = $1", [
    input.email.trim().toLowerCase(),
  ]);
  const user = result.rows[0];
  const valid = user
    ? await bcrypt.compare(input.password, user.password_hash)
    : false;
  if (!valid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect",
    );
  if (!user.email_verified_at)
    throw new AppError(
      403,
      "EMAIL_NOT_VERIFIED",
      "Verify your email before signing in",
    );
  if (user.status !== "active")
    throw new AppError(
      403,
      "ACCOUNT_UNAVAILABLE",
      "This account is not active",
    );
  const tokens = await createSession(user, meta);
  return { ...tokens, context: await loadContext(user.id) };
}

async function refresh(refreshToken, meta) {
  if (!refreshToken)
    throw new AppError(
      401,
      "REFRESH_REQUIRED",
      "Session refresh token is required",
    );
  return transaction(async (client) => {
    const sessions = await client.query(
      `SELECT s.id, s.user_id, u.email FROM app.sessions s
       JOIN app.users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
       FOR UPDATE`,
      [hashToken(refreshToken)],
    );
    if (!sessions.rowCount)
      throw new AppError(401, "SESSION_EXPIRED", "Session has expired");
    const session = sessions.rows[0];
    const next = await createSession(
      { id: session.user_id, email: session.email },
      meta,
      client,
    );
    const nextSession = await client.query(
      "SELECT id FROM app.sessions WHERE refresh_token_hash = $1",
      [hashToken(next.refreshToken)],
    );
    await client.query(
      "UPDATE app.sessions SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1",
      [session.id, nextSession.rows[0].id],
    );
    return { ...next, context: await loadContext(session.user_id, client) };
  });
}

async function logout(refreshToken) {
  if (refreshToken)
    await query(
      "UPDATE app.sessions SET revoked_at = NOW() WHERE refresh_token_hash = $1",
      [hashToken(refreshToken)],
    );
}

async function forgotPassword(email) {
  const result = await query(
    "SELECT id, email, full_name FROM app.users WHERE email = $1 AND email_verified_at IS NOT NULL AND status = 'active'",
    [email.trim().toLowerCase()],
  );
  if (!result.rowCount) return;
  const user = result.rows[0];
  await query(
    "UPDATE app.email_tokens SET used_at = NOW() WHERE user_id = $1 AND type = 'password_reset' AND used_at IS NULL",
    [user.id],
  );
  const reset = await createEmailToken(
    user.id,
    "password_reset",
    60 * 60 * 1000,
  );
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(reset.token)}`;
  await deliverEmail({
    eventKey: `password-reset:${reset.id}`,
    recipient: user.email,
    template: "password_reset",
    message: passwordResetEmail({ name: user.full_name, url }),
  }).catch(() => undefined);
}

async function resetPassword(token, password, meta) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await transaction(async (client) => {
    const tokens = await client.query(
      `SELECT id, user_id FROM app.email_tokens
       WHERE token_hash = $1 AND type = 'password_reset' AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token)],
    );
    if (!tokens.rowCount)
      throw new AppError(
        400,
        "INVALID_OR_EXPIRED_TOKEN",
        "Reset link is invalid or expired",
      );
    const record = tokens.rows[0];
    await client.query(
      "UPDATE app.users SET password_hash = $2 WHERE id = $1",
      [record.user_id, passwordHash],
    );
    await client.query(
      "UPDATE app.email_tokens SET used_at = NOW() WHERE id = $1",
      [record.id],
    );
    await client.query(
      "UPDATE app.sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [record.user_id],
    );
    await client.query(
      `INSERT INTO app.audit_events(actor_id, action, resource_type, resource_id, ip_address)
       VALUES ($1, 'account.password_reset', 'user', $1, $2)`,
      [record.user_id, meta.ip],
    );
  });
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  loadContext,
};
