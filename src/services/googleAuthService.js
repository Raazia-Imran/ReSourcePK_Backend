const { OAuth2Client } = require("google-auth-library");
const { transaction } = require("../db");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");
const { randomToken, hashToken } = require("../lib/tokens");
const auth = require("./authService");
const { verificationEmail } = require("../email/templates");
const { deliverEmail } = require("../email/deliveryService");
const { z } = require("zod");

let googleClient;

async function verifiedProfile(credential, nonce) {
  if (!env.GOOGLE_CLIENT_ID)
    throw new AppError(
      503,
      "GOOGLE_AUTH_NOT_CONFIGURED",
      "Google sign-in is not configured",
    );
  googleClient ||= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    if (error.code && /^E(AI_AGAIN|CONN|HOST|PIPE|TIMEDOUT)/.test(error.code))
      throw new AppError(
        503,
        "GOOGLE_AUTH_UNAVAILABLE",
        "Google sign-in could not be verified right now",
      );
    throw new AppError(
      401,
      "GOOGLE_CREDENTIAL_INVALID",
      "Google sign-in credential is invalid or expired",
    );
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true)
    throw new AppError(
      401,
      "GOOGLE_EMAIL_UNVERIFIED",
      "Use a Google account with a verified email address",
    );
  if (!payload.nonce || payload.nonce !== nonce)
    throw new AppError(
      401,
      "GOOGLE_NONCE_INVALID",
      "Google sign-in request expired or could not be verified",
    );

  const emailResult = z.string().email().max(254).safeParse(payload.email);
  if (!emailResult.success || payload.sub.length > 255)
    throw new AppError(
      401,
      "GOOGLE_CREDENTIAL_INVALID",
      "Google sign-in credential is invalid or expired",
    );
  const email = emailResult.data.trim().toLowerCase();
  let fullName = String(payload.name || "")
    .trim()
    .slice(0, 120);
  if (fullName.length < 2) fullName = email.split("@")[0].slice(0, 120);
  if (fullName.length < 2) fullName = "Google User";
  return {
    subject: payload.sub,
    email,
    fullName,
    emailAuthoritative: email.endsWith("@gmail.com") || Boolean(payload.hd),
  };
}

async function createNonce(purpose, userId = null) {
  if (!env.GOOGLE_CLIENT_ID)
    throw new AppError(
      503,
      "GOOGLE_AUTH_NOT_CONFIGURED",
      "Google sign-in is not configured",
    );
  const nonce = randomToken();
  await transaction(async (runner) => {
    await runner.query(
      "DELETE FROM app.google_auth_nonces WHERE expires_at < NOW() - INTERVAL '1 day'",
    );
    await runner.query(
      `INSERT INTO app.google_auth_nonces(nonce_hash,purpose,user_id,expires_at)
       VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')`,
      [hashToken(nonce), purpose, userId],
    );
  });
  return nonce;
}

async function consumeNonce(runner, nonce, purpose, userId = null) {
  const result = await runner.query(
    `SELECT id FROM app.google_auth_nonces
     WHERE nonce_hash=$1 AND purpose=$2 AND user_id IS NOT DISTINCT FROM $3
       AND consumed_at IS NULL AND expires_at>NOW()
     FOR UPDATE`,
    [hashToken(nonce), purpose, userId],
  );
  if (!result.rowCount)
    throw new AppError(
      401,
      "GOOGLE_NONCE_INVALID",
      "Google sign-in request expired or was already used",
    );
  await runner.query(
    "UPDATE app.google_auth_nonces SET consumed_at=NOW() WHERE id=$1",
    [result.rows[0].id],
  );
}

async function findGoogleUser(runner, subject) {
  const identity = await runner.query(
    `SELECT u.id,u.email,u.full_name,u.status,u.email_verified_at,g.account_type
     FROM app.google_identities g JOIN app.users u ON u.id=g.user_id
     WHERE g.google_subject=$1 FOR UPDATE OF u`,
    [subject],
  );
  return identity.rows[0] || null;
}

function assertIdentityType(user, accountType) {
  if (user && user.account_type !== accountType)
    throw new AppError(
      403,
      "GOOGLE_ACCOUNT_TYPE_MISMATCH",
      `This Google account is registered for ${user.account_type} sign-in`,
    );
}

async function createGoogleUser(
  runner,
  profile,
  accountType,
  organizationName,
  meta,
) {
  if (accountType === "seller" && !organizationName)
    throw new AppError(
      400,
      "ORGANIZATION_NAME_REQUIRED",
      "Organization name is required for first-time Seller sign-in",
    );
  const existing = await runner.query(
    `SELECT id FROM app.users WHERE email=$1 FOR UPDATE`,
    [profile.email],
  );
  if (existing.rowCount)
    throw new AppError(
      409,
      "GOOGLE_LINK_REQUIRED",
      "This email already has an account. Sign in to it first, then link Google from account settings.",
    );

  const created = await runner.query(
    `INSERT INTO app.users(email,full_name,password_hash,status,email_verified_at)
     VALUES($1,$2,NULL,$3,$4)
     RETURNING id,email,full_name,status,email_verified_at`,
    [
      profile.email,
      profile.fullName,
      profile.emailAuthoritative ? "active" : "pending",
      profile.emailAuthoritative ? new Date() : null,
    ],
  );
  const user = created.rows[0];
  await runner.query(
    `INSERT INTO app.google_identities(user_id,google_subject,account_type)
     VALUES($1,$2,$3)`,
    [user.id, profile.subject, accountType],
  );
  await runner.query(
    `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id,ip_address)
     VALUES($1,$3,'user',$1,$2)`,
    [
      user.id,
      meta.ip,
      accountType === "seller"
        ? "account.google_seller_registered"
        : "account.google_registered",
    ],
  );
  const verification = profile.emailAuthoritative
    ? null
    : await auth.createEmailToken(
        user.id,
        "verify_email",
        24 * 60 * 60 * 1000,
        runner,
      );
  return { user, verification };
}

async function submitSellerRequest(runner, userId, organizationName, meta) {
  if (!organizationName) return;
  const membership = await runner.query(
    `SELECT 1 FROM app.organization_memberships
     WHERE user_id=$1 AND role='owner' LIMIT 1`,
    [userId],
  );
  if (membership.rowCount) return;
  const currentRequest = await runner.query(
    `SELECT status FROM app.seller_requests
     WHERE user_id=$1 AND status IN ('pending','approved')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [userId],
  );
  if (currentRequest.rowCount && currentRequest.rows[0].status !== "rejected")
    return;
  const request = await runner.query(
    `INSERT INTO app.seller_requests(user_id,organization_name)
     VALUES($1,$2) RETURNING id`,
    [userId, organizationName],
  );
  await runner.query(
    `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id,ip_address)
     VALUES($1,'seller_request.submitted','seller_request',$2,$3)`,
    [userId, request.rows[0].id, meta.ip],
  );
}

async function deliverVerification(user, verification) {
  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(verification.token)}`;
  try {
    await deliverEmail({
      eventKey: `verify-email:${verification.id}`,
      recipient: user.email,
      template: "verify_email",
      message: verificationEmail({ name: user.full_name, url }),
    });
    return { verificationRequired: true, emailDelivery: "sent" };
  } catch {
    return { verificationRequired: true, emailDelivery: "pending" };
  }
}

async function signIn(credential, nonce, meta, options = {}) {
  const sellerSignup = options.accountType === "seller";
  const accountType = sellerSignup ? "seller" : "buyer";
  const noncePurpose = sellerSignup ? "seller_login" : "login";
  const organizationName = options.organizationName?.trim();
  const profile = await verifiedProfile(credential, nonce);
  const outcome = await transaction(async (runner) => {
    // Serialize first-time sign-ins for the same email so parallel callbacks
    // cannot create duplicate accounts or turn a uniqueness race into a 500.
    await runner.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [profile.email],
    );
    await consumeNonce(runner, nonce, noncePurpose);
    let user = await findGoogleUser(runner, profile.subject);
    assertIdentityType(user, accountType);
    let verification = null;
    if (!user)
      ({ user, verification } = await createGoogleUser(
        runner,
        profile,
        accountType,
        organizationName,
        meta,
      ));
    if (sellerSignup)
      await submitSellerRequest(runner, user.id, organizationName, meta);
    if (verification) return { verificationRequired: true, verification, user };

    if (user.status !== "active" || !user.email_verified_at) {
      if (user.status === "pending") return { verificationRequired: true };
      throw new AppError(
        403,
        "ACCOUNT_UNAVAILABLE",
        "This account is not active",
      );
    }

    const session = await auth.createSession(user, meta, runner);
    const context = await auth.loadContext(user.id, runner);
    return { ...session, context };
  });

  if (outcome.verification)
    return deliverVerification(outcome.user, outcome.verification);
  return outcome;
}

async function link(userId, credential, nonce, meta) {
  const profile = await verifiedProfile(credential, nonce);
  return transaction(async (runner) => {
    const users = await runner.query(
      `SELECT id,email,status,email_verified_at FROM app.users
       WHERE id=$1 FOR UPDATE`,
      [userId],
    );
    const user = users.rows[0];
    if (!user || user.status !== "active" || !user.email_verified_at)
      throw new AppError(
        403,
        "ACCOUNT_UNAVAILABLE",
        "An active verified account is required to link Google",
      );
    if (user.email.toLowerCase() !== profile.email)
      throw new AppError(
        403,
        "GOOGLE_EMAIL_MISMATCH",
        "Sign in to Google with the same verified email as this account",
      );

    await consumeNonce(runner, nonce, "link", userId);

    const subjectOwner = await runner.query(
      "SELECT user_id FROM app.google_identities WHERE google_subject=$1 FOR UPDATE",
      [profile.subject],
    );
    if (subjectOwner.rowCount && subjectOwner.rows[0].user_id !== userId)
      throw new AppError(
        409,
        "GOOGLE_IDENTITY_IN_USE",
        "This Google account is linked to another ReSource PK account",
      );
    const existing = await runner.query(
      "SELECT google_subject FROM app.google_identities WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    if (existing.rowCount) {
      if (existing.rows[0].google_subject === profile.subject)
        return { linked: true, alreadyLinked: true };
      throw new AppError(
        409,
        "GOOGLE_IDENTITY_ALREADY_LINKED",
        "This ReSource PK account already has a Google account linked",
      );
    }

    await runner.query(
      "INSERT INTO app.google_identities(user_id,google_subject) VALUES($1,$2)",
      [userId, profile.subject],
    );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id,ip_address)
       VALUES($1,'account.google_linked','user',$1,$2)`,
      [userId, meta.ip],
    );
    return { linked: true, alreadyLinked: false };
  });
}

module.exports = { createNonce, signIn, link };
