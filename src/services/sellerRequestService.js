const { query, transaction } = require("../db");
const { AppError } = require("../lib/errors");

function slugify(value) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 75) || "organization"
  );
}

async function submit(userId, organizationName, meta) {
  return transaction(async (runner) => {
    const account = await runner.query(
      "SELECT status,email_verified_at FROM app.users WHERE id=$1 FOR UPDATE",
      [userId],
    );
    if (
      !account.rowCount ||
      account.rows[0].status !== "active" ||
      !account.rows[0].email_verified_at
    )
      throw new AppError(
        403,
        "ACCOUNT_UNAVAILABLE",
        "Verify your active Buyer account before requesting Seller access",
      );

    const membership = await runner.query(
      `SELECT 1 FROM app.organization_memberships
       WHERE user_id=$1 AND role='owner' LIMIT 1`,
      [userId],
    );
    if (membership.rowCount)
      throw new AppError(
        409,
        "SELLER_ACCESS_ALREADY_GRANTED",
        "This account already has Seller access",
      );

    const requests = await runner.query(
      `SELECT status FROM app.seller_requests
       WHERE user_id=$1 AND status IN ('pending','approved')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (requests.rows[0]?.status === "pending")
      throw new AppError(
        409,
        "SELLER_REQUEST_PENDING",
        "Your Seller access request is awaiting review",
      );
    if (requests.rows[0]?.status === "approved")
      throw new AppError(
        409,
        "SELLER_ACCESS_ALREADY_GRANTED",
        "This account already has Seller access",
      );

    const created = await runner.query(
      `INSERT INTO app.seller_requests(user_id,organization_name)
       VALUES($1,$2) RETURNING id,user_id,organization_name,status,created_at`,
      [userId, organizationName.trim()],
    );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id,ip_address)
       VALUES($1,'seller_request.submitted','seller_request',$2,$3)`,
      [userId, created.rows[0].id, meta.ip],
    );
    return created.rows[0];
  });
}

async function mine(userId) {
  const result = await query(
    `SELECT id,organization_name,status,review_note,organization_id,created_at,reviewed_at
     FROM app.seller_requests WHERE user_id=$1 ORDER BY created_at DESC,id DESC`,
    [userId],
  );
  return result.rows;
}

async function requireReviewer(userId, runner = { query }) {
  const result = await runner.query(
    `SELECT 1 FROM app.platform_assignments p
     JOIN app.users u ON u.id=p.user_id
     WHERE p.user_id=$1 AND p.role IN ('platform_admin','platform_reviewer')
       AND u.status='active' AND u.email_verified_at IS NOT NULL`,
    [userId],
  );
  if (!result.rowCount)
    throw new AppError(
      403,
      "PLATFORM_REVIEW_ACCESS_REQUIRED",
      "Platform Reviewer or Platform Admin access is required",
    );
}

async function list(userId, { status = "pending", limit = 50, offset = 0 }) {
  await requireReviewer(userId);
  const result = await query(
    `SELECT r.id,r.user_id,u.full_name AS applicant_name,u.email AS applicant_email,
            r.organization_name,r.status,r.reviewed_by,reviewer.full_name AS reviewer_name,
            r.review_note,r.organization_id,r.created_at,r.reviewed_at
     FROM app.seller_requests r
     JOIN app.users u ON u.id=r.user_id
     LEFT JOIN app.users reviewer ON reviewer.id=r.reviewed_by
     WHERE ($1::text='all' OR r.status=$1::varchar)
     ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC,r.id DESC
     LIMIT $2 OFFSET $3`,
    [status, limit, offset],
  );
  return result.rows;
}

async function decide(reviewerId, requestId, decision, reviewNote, meta) {
  return transaction(async (runner) => {
    await requireReviewer(reviewerId, runner);
    const requestResult = await runner.query(
      `SELECT * FROM app.seller_requests WHERE id=$1 FOR UPDATE`,
      [requestId],
    );
    if (!requestResult.rowCount)
      throw new AppError(404, "SELLER_REQUEST_NOT_FOUND", "Request not found");
    const request = requestResult.rows[0];
    if (request.status !== "pending")
      throw new AppError(
        409,
        "SELLER_REQUEST_ALREADY_REVIEWED",
        "This request has already been reviewed",
      );

    let organizationId = null;
    if (decision === "approved") {
      const account = await runner.query(
        `SELECT status,email_verified_at FROM app.users WHERE id=$1 FOR UPDATE`,
        [request.user_id],
      );
      if (
        !account.rowCount ||
        account.rows[0].status !== "active" ||
        !account.rows[0].email_verified_at
      )
        throw new AppError(
          409,
          "APPLICANT_UNAVAILABLE",
          "The applicant account is not active and verified",
        );
      const membership = await runner.query(
        `SELECT 1 FROM app.organization_memberships
         WHERE user_id=$1 AND role='owner' LIMIT 1`,
        [request.user_id],
      );
      if (membership.rowCount)
        throw new AppError(
          409,
          "SELLER_ACCESS_ALREADY_GRANTED",
          "The applicant already has Seller access",
        );

      const slug = `${slugify(request.organization_name)}-${request.user_id.slice(0, 6)}`;
      const organization = await runner.query(
        `INSERT INTO app.organizations(name,slug,created_by)
         VALUES($1,$2,$3) RETURNING id`,
        [request.organization_name, slug, request.user_id],
      );
      organizationId = organization.rows[0].id;
      await runner.query(
        `INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff)
         VALUES($1,$2,'owner',TRUE)`,
        [organizationId, request.user_id],
      );
    }

    const updated = await runner.query(
      `UPDATE app.seller_requests
       SET status=$2,reviewed_by=$3,reviewed_at=NOW(),review_note=$4,organization_id=$5
       WHERE id=$1
       RETURNING id,user_id,organization_name,status,reviewed_by,review_note,organization_id,created_at,reviewed_at`,
      [requestId, decision, reviewerId, reviewNote || null, organizationId],
    );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason,ip_address)
       VALUES($1,$2,$3,'seller_request',$4,$5,$6)`,
      [
        reviewerId,
        organizationId,
        `seller_request.${decision}`,
        requestId,
        reviewNote || null,
        meta.ip,
      ],
    );
    return updated.rows[0];
  });
}

async function assignReviewer(adminId, email) {
  return transaction(async (runner) => {
    const admin = await runner.query(
      `SELECT 1 FROM app.platform_assignments p JOIN app.users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND p.role='platform_admin' AND u.status='active'
       AND u.email_verified_at IS NOT NULL FOR SHARE OF p,u`,
      [adminId],
    );
    if (!admin.rowCount)
      throw new AppError(
        403,
        "PLATFORM_ADMIN_REQUIRED",
        "Platform Admin access is required to assign reviewers",
      );
    const user = await runner.query(
      `SELECT id FROM app.users WHERE email=$1 AND status='active' AND email_verified_at IS NOT NULL FOR UPDATE`,
      [email.trim().toLowerCase()],
    );
    if (!user.rowCount)
      throw new AppError(
        404,
        "ACTIVE_USER_NOT_FOUND",
        "An active verified account with that email was not found",
      );
    await runner.query(
      `INSERT INTO app.platform_assignments(user_id,role,granted_by)
       VALUES($1,'platform_reviewer',$2)
       ON CONFLICT(user_id,role) DO NOTHING`,
      [user.rows[0].id, adminId],
    );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id)
       VALUES($1,'platform_reviewer.assigned','user',$2)`,
      [adminId, user.rows[0].id],
    );
    return { userId: user.rows[0].id, role: "platform_reviewer" };
  });
}

async function revokeReviewer(adminId, userId) {
  return transaction(async (runner) => {
    const admin = await runner.query(
      `SELECT 1 FROM app.platform_assignments p JOIN app.users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND p.role='platform_admin' AND u.status='active'
       AND u.email_verified_at IS NOT NULL FOR SHARE OF p,u`,
      [adminId],
    );
    if (!admin.rowCount)
      throw new AppError(
        403,
        "PLATFORM_ADMIN_REQUIRED",
        "Platform Admin access is required to manage reviewers",
      );
    const removed = await runner.query(
      `DELETE FROM app.platform_assignments
       WHERE user_id=$1 AND role='platform_reviewer' RETURNING user_id`,
      [userId],
    );
    if (!removed.rowCount)
      throw new AppError(
        404,
        "PLATFORM_REVIEWER_NOT_FOUND",
        "That account does not have Platform Reviewer access",
      );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id)
       VALUES($1,'platform_reviewer.revoked','user',$2)`,
      [adminId, userId],
    );
    return { userId, role: "platform_reviewer", revoked: true };
  });
}

module.exports = {
  submit,
  mine,
  list,
  decide,
  assignReviewer,
  revokeReviewer,
};
