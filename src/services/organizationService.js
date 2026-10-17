const bcrypt = require("bcryptjs");
const { query, transaction } = require("../db");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");
const { randomToken, hashToken } = require("../lib/tokens");
const { deliverEmail } = require("../email/deliveryService");
const { organizationInviteEmail } = require("../email/templates");
const STAFF_PERMISSIONS = new Set(["listings.view", "listings.manage"]);

function normalizeStaffPermissions(permissions = []) {
  if (
    !Array.isArray(permissions) ||
    permissions.some((permission) => !STAFF_PERMISSIONS.has(permission))
  )
    throw new AppError(
      400,
      "INVALID_STAFF_PERMISSIONS",
      "Unsupported Staff permission",
    );
  return [...new Set(permissions)];
}

async function replaceStaffPermissions(
  client,
  membershipId,
  grantedBy,
  permissions,
) {
  await client.query(
    "DELETE FROM app.organization_membership_permissions WHERE membership_id=$1",
    [membershipId],
  );
  for (const permission of normalizeStaffPermissions(permissions)) {
    await client.query(
      `INSERT INTO app.organization_membership_permissions(membership_id,permission,granted_by) VALUES($1,$2,$3)`,
      [membershipId, permission, grantedBy],
    );
  }
}

async function createOrganization() {
  throw new AppError(
    403,
    "SELLER_REVIEW_REQUIRED",
    "Submit a Seller access request and wait for platform approval before creating an organization",
  );
}

async function requireInviter(
  userId,
  organizationId,
  requestedRole,
  runner = { query },
) {
  const result = await runner.query(
    `SELECT m.role, m.can_invite_staff, o.name AS organization_name, u.full_name
     FROM app.organization_memberships m JOIN app.organizations o ON o.id=m.organization_id
     JOIN app.users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND o.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL FOR SHARE OF m,o,u`,
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
  let actor;
  const email = input.email.trim().toLowerCase();
  const staffPermissions = normalizeStaffPermissions(input.staffPermissions);
  if (input.role !== "staff" && staffPermissions.length)
    throw new AppError(
      400,
      "INVALID_STAFF_PERMISSIONS",
      "Permissions can only be assigned to Staff",
    );
  if (input.role === "staff" && input.canInviteStaff)
    throw new AppError(
      400,
      "INVALID_STAFF_PERMISSIONS",
      "Staff cannot invite other Staff",
    );
  const token = randomToken();
  const invitation = await transaction(async (client) => {
    actor = await requireInviter(userId, organizationId, input.role, client);
    await client.query(
      `UPDATE app.organization_invitations SET revoked_at=NOW() WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [organizationId, email],
    );
    const result = await client.query(
      `INSERT INTO app.organization_invitations(organization_id,email,role,can_invite_staff,staff_permissions,token_hash,invited_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '72 hours') RETURNING id`,
      [
        organizationId,
        email,
        input.role,
        input.canInviteStaff,
        staffPermissions,
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
    `SELECT i.email,i.role,i.staff_permissions,i.expires_at,o.name AS organization_name
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
  const account = await query("SELECT 1 FROM app.users WHERE email=$1", [
    invitation.email,
  ]);
  return {
    organization_name: invitation.organization_name,
    role: invitation.role,
    permissions: invitation.staff_permissions || [],
    expires_at: invitation.expires_at,
    email: invitation.email,
    account_exists: Boolean(account.rowCount),
  };
}

async function validateInvitationAuthority(client, invite) {
  if (!["manager", "staff"].includes(invite.role))
    throw new AppError(
      400,
      "INVALID_OR_EXPIRED_INVITATION",
      "Invitation role is no longer supported",
    );
  await requireInviter(
    invite.invited_by,
    invite.organization_id,
    invite.role,
    client,
  );
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
    await validateInvitationAuthority(client, invite);
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
    const membership = await client.query(
      `INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff) VALUES($1,$2,$3,$4) RETURNING id`,
      [invite.organization_id, user.id, invite.role, invite.can_invite_staff],
    );
    await replaceStaffPermissions(
      client,
      membership.rows[0].id,
      invite.invited_by,
      invite.staff_permissions || [],
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
    await validateInvitationAuthority(client, invite);
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
    const membership = await client.query(
      "SELECT role FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
      [invite.organization_id, userId],
    );
    if (membership.rows[0]?.role === "owner")
      throw new AppError(
        409,
        "OWNER_ROLE_PROTECTED",
        "An invitation cannot replace an Owner role",
      );
    const updatedMembership = await client.query(
      `INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',can_invite_staff=EXCLUDED.can_invite_staff RETURNING id`,
      [invite.organization_id, userId, invite.role, invite.can_invite_staff],
    );
    await replaceStaffPermissions(
      client,
      updatedMembership.rows[0].id,
      invite.invited_by,
      invite.staff_permissions || [],
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

async function setStaffPermissions(
  userId,
  organizationId,
  membershipId,
  permissions,
  meta,
) {
  const normalized = normalizeStaffPermissions(permissions);
  return transaction(async (client) => {
    await requireInviter(userId, organizationId, "staff", client);
    const target = await client.query(
      `SELECT id,role FROM app.organization_memberships
       WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,
      [membershipId, organizationId],
    );
    if (!target.rowCount || target.rows[0].role !== "staff")
      throw new AppError(
        404,
        "STAFF_MEMBER_NOT_FOUND",
        "Active Staff membership not found",
      );
    await replaceStaffPermissions(client, membershipId, userId, normalized);
    await client.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason,ip_address)
       VALUES($1,$2,'organization.staff_permissions_updated','organization_membership',$3,$4,$5)`,
      [userId, organizationId, membershipId, normalized.join(","), meta.ip],
    );
    return { membershipId, permissions: normalized };
  });
}

async function setManagerPermissions(
  userId,
  organizationId,
  membershipId,
  permissions,
  meta,
) {
  if (
    !Array.isArray(permissions) ||
    permissions.some((p) => p !== "orders.confirm")
  )
    throw new AppError(
      400,
      "INVALID_MANAGER_PERMISSIONS",
      "Managers may only receive the orders.confirm permission here",
    );
  const normalized = [...new Set(permissions)];
  return transaction(async (client) => {
    await requireInviter(userId, organizationId, "manager", client);
    const target = await client.query(
      `SELECT id,role FROM app.organization_memberships
       WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,
      [membershipId, organizationId],
    );
    if (!target.rowCount || target.rows[0].role !== "manager")
      throw new AppError(
        404,
        "MANAGER_MEMBER_NOT_FOUND",
        "Active Manager membership not found",
      );
    if (normalized.includes("orders.confirm")) {
      await client.query(
        `INSERT INTO app.organization_membership_permissions(membership_id,permission,granted_by)
         VALUES($1,'orders.confirm',$2)
         ON CONFLICT(membership_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by`,
        [membershipId, userId],
      );
    } else {
      await client.query(
        `DELETE FROM app.organization_membership_permissions
         WHERE membership_id=$1 AND permission='orders.confirm'`,
        [membershipId],
      );
    }
    await client.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason,ip_address)
       VALUES($1,$2,'organization.manager_permissions_updated','organization_membership',$3,$4,$5)`,
      [userId, organizationId, membershipId, normalized.join(","), meta.ip],
    );
    return { membershipId, permissions: normalized };
  });
}

async function listMembers(userId, organizationId) {
  return transaction(async (client) => {
    await requireInviter(userId, organizationId, "staff", client);
    const result = await client.query(
      `SELECT m.id AS membership_id,m.user_id,u.email,u.full_name,m.role,m.can_invite_staff,
       COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM app.organization_membership_permissions p WHERE p.membership_id=m.id),ARRAY[]::TEXT[]) AS permissions
       FROM app.organization_memberships m JOIN app.users u ON u.id=m.user_id
       WHERE m.organization_id=$1 AND m.status='active' AND u.status='active'
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,u.full_name`,
      [organizationId],
    );
    return result.rows;
  });
}

module.exports = {
  createOrganization,
  createInvitation,
  invitationDetails,
  acceptNewUser,
  acceptExistingUser,
  setStaffPermissions,
  setManagerPermissions,
  listMembers,
};
