const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");
const { randomToken, hashToken } = require("../lib/tokens");
const { deliverEmail } = require("../email/deliveryService");
const { organizationInviteEmail } = require("../email/templates");

async function requireInviter(userId, organizationId, requestedRole) {
  const result = await query(
    `SELECT m.role, m.can_invite_staff, o.name AS organization_name, u.full_name
     FROM app.organization_memberships m JOIN app.organizations o ON o.id=m.organization_id
     JOIN app.users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND o.status='active'`,
    [userId, organizationId],
  );
  if (!result.rowCount)
    throw new AppError(
      403,
      "ORG_ACCESS_DENIED",
      "You cannot manage this organization",
    );
  const actor = result.rows[0];
  const allowed =
    actor.role === "owner" ||
    actor.role === "org_admin" ||
    (actor.role === "manager" &&
      actor.can_invite_staff &&
      requestedRole === "staff");
  if (!allowed)
    throw new AppError(
      403,
      "INVITE_NOT_ALLOWED",
      "Your organization role cannot issue this invitation",
    );
  return actor;
}

async function createInvitation(userId, organizationId, input, meta) {
  const actor = await requireInviter(userId, organizationId, input.role);
  const email = input.email.trim().toLowerCase();
  const token = randomToken();
  const invitation = await transaction(async (client) => {
    await client.query(
      `UPDATE app.organization_invitations SET revoked_at=NOW() WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [organizationId, email],
    );
    const result = await client.query(
      `INSERT INTO app.organization_invitations(organization_id,email,role,can_invite_staff,token_hash,invited_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '72 hours') RETURNING id`,
      [
        organizationId,
        email,
        input.role,
        input.canInviteStaff,
        hashToken(token),
        userId,
      ],
    );
    await client.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,ip_address) VALUES($1,$2,'organization.invitation_created','organization_invitation',$3,$4)`,
      [userId, organizationId, result.rows[0].id, meta.ip],
    );
    return result.rows[0];
  });
  const url = `${env.APP_URL}/accept-invitation?token=${encodeURIComponent(token)}`;
  await deliverEmail({
    eventKey: `organization-invite:${invitation.id}`,
    recipient: email,
    template: "organization_invite",
    message: organizationInviteEmail({
      organizationName: actor.organization_name,
      inviterName: actor.full_name,
      role: input.role.replace("_", " "),
      url,
    }),
  });
  return { id: invitation.id, email, expiresInHours: 72 };
}

async function invitationDetails(token) {
  const result = await query(
    `SELECT i.email,i.role,i.expires_at,o.name AS organization_name
     FROM app.organization_invitations i JOIN app.organizations o ON o.id=i.organization_id
     WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NOW()`,
    [hashToken(token)],
  );
  if (!result.rowCount)
    throw new AppError(
      400,
      "INVALID_OR_EXPIRED_INVITATION",
      "Invitation is invalid or expired",
    );
  const invitation = result.rows[0];
  const [name, domain] = invitation.email.split("@");
  return {
    organization_name: invitation.organization_name,
    role: invitation.role,
    expires_at: invitation.expires_at,
    email_hint: `${name.slice(0, 2)}***@${domain}`,
  };
}

async function acceptNewUser(token, input, meta) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return transaction(async (client) => {
    const inviteResult = await client.query(
      `SELECT * FROM app.organization_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!inviteResult.rowCount)
      throw new AppError(
        400,
        "INVALID_OR_EXPIRED_INVITATION",
        "Invitation is invalid or expired",
      );
    const invite = inviteResult.rows[0];
    const existing = await client.query(
      "SELECT id FROM app.users WHERE email=$1",
      [invite.email],
    );
    if (existing.rowCount)
      throw new AppError(
        409,
        "ACCOUNT_EXISTS",
        "Sign in and accept this invitation from your account",
      );
    const users = await client.query(
      `INSERT INTO app.users(email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'active',NOW()) RETURNING id,email`,
      [invite.email, input.fullName.trim(), passwordHash],
    );
    const user = users.rows[0];
    await client.query(
      `INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff) VALUES($1,$2,$3,$4)`,
      [invite.organization_id, user.id, invite.role, invite.can_invite_staff],
    );
    await client.query(
      "UPDATE app.organization_invitations SET accepted_at=NOW() WHERE id=$1",
      [invite.id],
    );
    await client.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,ip_address) VALUES($1,$2,'organization.invitation_accepted','organization_invitation',$3,$4)`,
      [user.id, invite.organization_id, invite.id, meta.ip],
    );
    return { accepted: true, email: user.email };
  });
}

async function acceptExistingUser(userId, token, meta) {
  return transaction(async (client) => {
    const invites = await client.query(
      `SELECT * FROM app.organization_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [hashToken(token)],
    );
    if (!invites.rowCount)
      throw new AppError(
        400,
        "INVALID_OR_EXPIRED_INVITATION",
        "Invitation is invalid or expired",
      );
    const invite = invites.rows[0];
    const user = await client.query("SELECT email FROM app.users WHERE id=$1", [
      userId,
    ]);
    if (
      !user.rowCount ||
      user.rows[0].email.toLowerCase() !== invite.email.toLowerCase()
    )
      throw new AppError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "This invitation belongs to another email address",
      );
    await client.query(
      `INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',can_invite_staff=EXCLUDED.can_invite_staff`,
      [invite.organization_id, userId, invite.role, invite.can_invite_staff],
    );
    await client.query(
      "UPDATE app.organization_invitations SET accepted_at=NOW() WHERE id=$1",
      [invite.id],
    );
    await client.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,ip_address) VALUES($1,$2,'organization.invitation_accepted','organization_invitation',$3,$4)`,
      [userId, invite.organization_id, invite.id, meta.ip],
    );
    return { accepted: true };
  });
}

module.exports = {
  createInvitation,
  invitationDetails,
  acceptNewUser,
  acceptExistingUser,
};
