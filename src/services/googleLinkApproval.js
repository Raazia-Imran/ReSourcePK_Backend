// Operator-approved recovery for one email, with a mandatory expiry.
// Google signature, audience and nonce validation happen before this is called.
async function linkApprovedGoogleAccount(
  runner,
  user,
  profile,
  meta,
  config,
  now = Date.now(),
) {
  const expires = Date.parse(config.GOOGLE_LINK_APPROVAL_EXPIRES_AT || "");
  if (
    !config.GOOGLE_LINK_APPROVAL_EMAIL ||
    !Number.isFinite(expires) ||
    expires <= now ||
    profile.email !== config.GOOGLE_LINK_APPROVAL_EMAIL.toLowerCase() ||
    user.email.toLowerCase() !== profile.email ||
    !profile.emailAuthoritative ||
    user.status !== "active" ||
    !user.email_verified_at
  )
    return null;
  const linked = await runner.query(
    "SELECT user_id FROM app.google_identities WHERE user_id=$1 OR google_subject=$2",
    [user.id, profile.subject],
  );
  if (linked.rowCount) return null;
  await runner.query(
    "INSERT INTO app.google_identities(user_id,google_subject) VALUES($1,$2)",
    [user.id, profile.subject],
  );
  await runner.query(
    "INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id,ip_address) VALUES($1,'account.google_linked_recovery','user',$1,$2)",
    [user.id, meta.ip],
  );
  return user;
}
module.exports = { linkApprovedGoogleAccount };
