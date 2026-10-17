const { AppError } = require("../lib/errors");

async function requirePlatformPermission(userId, permission, runner) {
  const result = await runner.query(
    `SELECT p.role, EXISTS(
       SELECT 1 FROM app.platform_reviewer_permissions rp
       WHERE rp.user_id=p.user_id AND rp.permission=$2
     ) AS has_permission
     FROM app.platform_assignments p JOIN app.users u ON u.id=p.user_id
     WHERE p.user_id=$1 AND p.role IN ('platform_admin','platform_reviewer')
       AND u.status='active' AND u.email_verified_at IS NOT NULL
     FOR SHARE OF p,u`,
    [userId, permission],
  );
  const allowed =
    result.rows[0]?.role === "platform_admin" || result.rows[0]?.has_permission;
  if (!allowed)
    throw new AppError(
      403,
      "PLATFORM_PERMISSION_REQUIRED",
      `Platform permission required: ${permission}`,
    );
}

module.exports = { requirePlatformPermission };
