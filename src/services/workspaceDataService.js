const { query, transaction } = require("../db");
const { AppError } = require("../lib/errors");

async function requireOrganizationMember(userId, organizationId, roles) {
  const result = await query(
    `SELECT m.role, m.can_invite_staff, o.id AS organization_id,
       COALESCE((SELECT array_agg(p.permission) FROM app.organization_membership_permissions p
         WHERE p.membership_id=m.id),ARRAY[]::TEXT[]) AS permissions
     FROM app.organization_memberships m
     JOIN app.organizations o ON o.id=m.organization_id
     JOIN app.users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active'
       AND o.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL`,
    [userId, organizationId],
  );
  const membership = result.rows[0];
  if (!membership || !roles.includes(membership.role))
    throw new AppError(403, "ORG_ACCESS_DENIED", "Organization access denied");
  return membership;
}

async function requirePlatformAdmin(userId, runner = { query }) {
  const result = await runner.query(
    `SELECT 1 FROM app.platform_assignments p
     JOIN app.users u ON u.id=p.user_id
     WHERE p.user_id=$1 AND p.role='platform_admin' AND u.status='active'
       AND u.email_verified_at IS NOT NULL`,
    [userId],
  );
  if (!result.rowCount)
    throw new AppError(
      403,
      "PLATFORM_ADMIN_REQUIRED",
      "Platform Admin access required",
    );
}

async function buyerImpact(userId) {
  const [summary, recent] = await Promise.all([
    query(
      `SELECT count(*)::int AS order_count,
         count(*) FILTER (WHERE o.status IN ('group_open','pending_seller_confirmation'))::int AS awaiting_seller,
         count(*) FILTER (WHERE o.status='pending_payment')::int AS awaiting_payment,
         count(*) FILTER (WHERE o.status='paid')::int AS paid_orders,
         COALESCE((SELECT json_agg(json_build_object('unit',paid.unit,'quantity',paid.quantity)
           ORDER BY paid.unit) FROM (
             SELECT o2.unit,sum(o2.quantity)::text AS quantity
             FROM app.orders o2 JOIN app.listings l2 ON l2.id=o2.listing_id
             WHERE o2.buyer_id=$1 AND o2.status='paid' AND l2.is_demo=false
             GROUP BY o2.unit
           ) paid),'[]'::json) AS paid_quantity_by_unit,
         COALESCE(sum(o.total_minor) FILTER (WHERE o.status='paid'),0)::text AS paid_total_minor
       FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       WHERE o.buyer_id=$1 AND l.is_demo=false`,
      [userId],
    ),
    query(
      `SELECT o.id,o.status,o.quantity::text,o.unit,o.total_minor::text,
         o.created_at,l.title AS listing_title,org.name AS organization_name
       FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       JOIN app.organizations org ON org.id=o.organization_id
       WHERE o.buyer_id=$1 AND l.is_demo=false
       ORDER BY o.created_at DESC,o.id DESC LIMIT 10`,
      [userId],
    ),
  ]);
  return { summary: summary.rows[0], recent: recent.rows };
}

async function organizationAnalytics(userId, organizationId) {
  const membership = await requireOrganizationMember(userId, organizationId, [
    "owner",
    "manager",
  ]);
  if (
    membership.role === "manager" &&
    !membership.permissions.includes("orders.confirm")
  )
    throw new AppError(
      403,
      "ANALYTICS_ACCESS_DENIED",
      "Organization analytics require Owner access or the Manager order permission",
    );
  const [listings, orders, monthly] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status='published')::int AS published,
         count(*) FILTER (WHERE status='pending_review')::int AS pending_review,
         count(*) FILTER (WHERE status='draft')::int AS drafts
       FROM app.listings WHERE organization_id=$1 AND is_demo=false`,
      [organizationId],
    ),
    query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status='pending_seller_confirmation')::int AS awaiting_response,
         count(*) FILTER (WHERE status='pending_payment')::int AS awaiting_payment,
         count(*) FILTER (WHERE status='paid')::int AS paid,
         COALESCE((SELECT json_agg(json_build_object('unit',requested.unit,'quantity',requested.quantity)
           ORDER BY requested.unit) FROM (
             SELECT o2.unit,sum(o2.quantity)::text AS quantity
             FROM app.orders o2 JOIN app.listings l2 ON l2.id=o2.listing_id
             WHERE o2.organization_id=$1 AND l2.is_demo=false
             GROUP BY o2.unit
           ) requested),'[]'::json) AS requested_quantity_by_unit,
         COALESCE(sum(total_minor) FILTER (WHERE status='paid'),0)::text AS paid_total_minor
       FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       WHERE o.organization_id=$1 AND l.is_demo=false`,
      [organizationId],
    ),
    query(
      `SELECT date_trunc('month',o.created_at)::date::text AS month,
         count(*)::int AS orders,
         COALESCE(sum(o.quantity),0)::text AS quantity
       FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       WHERE o.organization_id=$1 AND l.is_demo=false
         AND o.created_at >= date_trunc('month',now()) - interval '5 months'
       GROUP BY 1 ORDER BY 1`,
      [organizationId],
    ),
  ]);
  return {
    listings: listings.rows[0],
    orders: orders.rows[0],
    monthly: monthly.rows,
  };
}

async function organizationSettings(userId, organizationId) {
  const membership = await requireOrganizationMember(userId, organizationId, [
    "owner",
    "manager",
    "staff",
  ]);
  const result = await query(
    `SELECT id,name,slug,status,created_at,updated_at
     FROM app.organizations WHERE id=$1`,
    [organizationId],
  );
  return { ...result.rows[0], role: membership.role };
}

async function updateOrganizationSettings(userId, organizationId, name, ip) {
  return transaction(async (runner) => {
    const membership = await runner.query(
      `SELECT m.role FROM app.organization_memberships m
       JOIN app.organizations o ON o.id=m.organization_id
       JOIN app.users u ON u.id=m.user_id
       WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active'
         AND o.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL
       FOR UPDATE OF m,o`,
      [userId, organizationId],
    );
    if (!membership.rowCount || membership.rows[0].role !== "owner")
      throw new AppError(
        403,
        "OWNER_ACCESS_REQUIRED",
        "Only the Owner can update organization settings",
      );
    const updated = await runner.query(
      `UPDATE app.organizations SET name=$2 WHERE id=$1
       RETURNING id,name,slug,status,created_at,updated_at`,
      [organizationId, name],
    );
    await runner.query(
      `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason,ip_address)
       VALUES($1,$2,'organization.settings_updated','organization',$2,$3,$4)`,
      [userId, organizationId, `name=${name}`, ip],
    );
    return { ...updated.rows[0], role: membership.rows[0].role };
  });
}

async function platformOrganizations(userId, limit, offset) {
  await requirePlatformAdmin(userId);
  const [count, rows] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM app.organizations`),
    query(
      `SELECT o.id,o.name,o.slug,o.status,o.created_at,
         EXISTS(SELECT 1 FROM app.demo_seed_records d WHERE d.kind='organization' AND d.record_id=o.id) AS is_demo,
         count(DISTINCT m.user_id)::int AS member_count,
         count(DISTINCT l.id)::int AS listing_count
       FROM app.organizations o
       LEFT JOIN app.organization_memberships m ON m.organization_id=o.id AND m.status='active'
       LEFT JOIN app.listings l ON l.organization_id=o.id
       GROUP BY o.id ORDER BY o.created_at DESC,o.id LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  return { items: rows.rows, total: count.rows[0].total, limit, offset };
}

async function platformUsers(userId, limit, offset) {
  await requirePlatformAdmin(userId);
  const [count, rows] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM app.users`),
    query(
      `SELECT u.id,u.email,u.full_name,u.status,u.email_verified_at,u.created_at,
         EXISTS(SELECT 1 FROM app.demo_seed_records d WHERE d.kind='user' AND d.record_id=u.id) AS is_demo,
         (SELECT array_agg(DISTINCT m.role::text ORDER BY m.role::text)
            FROM app.organization_memberships m WHERE m.user_id=u.id AND m.status='active') AS organization_roles,
         (SELECT array_agg(DISTINCT p.role::text ORDER BY p.role::text)
            FROM app.platform_assignments p WHERE p.user_id=u.id) AS platform_roles
       FROM app.users u ORDER BY u.created_at DESC,u.id LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  return { items: rows.rows, total: count.rows[0].total, limit, offset };
}

async function platformAnalytics(userId) {
  await requirePlatformAdmin(userId);
  const [users, organizations, listings, orders, applications, activity] =
    await Promise.all([
      query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE u.email_verified_at IS NOT NULL)::int AS verified
         FROM app.users u WHERE NOT EXISTS(
           SELECT 1 FROM app.demo_seed_records d WHERE d.kind='user' AND d.record_id=u.id)`,
      ),
      query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE o.status='active')::int AS active
         FROM app.organizations o WHERE NOT EXISTS(
           SELECT 1 FROM app.demo_seed_records d WHERE d.kind='organization' AND d.record_id=o.id)`,
      ),
      query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE l.status='published')::int AS published,
           count(*) FILTER (WHERE l.status='pending_review')::int AS pending_review
         FROM app.listings l WHERE l.is_demo=false`,
      ),
      query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE o.status='paid')::int AS paid,
           count(*) FILTER (WHERE o.status IN ('pending_seller_confirmation','group_open'))::int AS awaiting_seller,
           COALESCE(sum(o.total_minor) FILTER (WHERE o.status='paid'),0)::text AS paid_total_minor
         FROM app.orders o JOIN app.listings l ON l.id=o.listing_id WHERE l.is_demo=false`,
      ),
      query(
        `SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
           count(*) FILTER (WHERE status='approved')::int AS approved,
           count(*) FILTER (WHERE status='rejected')::int AS rejected
         FROM app.seller_requests`,
      ),
      query(
        `SELECT date_trunc('day',created_at)::date::text AS day,count(*)::int AS events
         FROM app.audit_events WHERE created_at >= now()-interval '13 days'
         GROUP BY 1 ORDER BY 1`,
      ),
    ]);
  return {
    users: users.rows[0],
    organizations: organizations.rows[0],
    listings: listings.rows[0],
    orders: orders.rows[0],
    applications: applications.rows[0],
    auditActivity: activity.rows,
  };
}

module.exports = {
  buyerImpact,
  organizationAnalytics,
  organizationSettings,
  updateOrganizationSettings,
  platformOrganizations,
  platformUsers,
  platformAnalytics,
};
