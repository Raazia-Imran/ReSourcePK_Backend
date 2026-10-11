const db = require("../../db");
const { scaled } = require("./validation");
const { AppError } = require("../../lib/errors");
const publicColumns = `l.id,l.title,l.description,l.material,l.condition,l.color,l.composition,l.location,l.unit,l.quantity,l.min_order_quantity,l.price_per_unit,l.price_per_unit_minor,l.is_demo,l.created_at,o.name AS organization_name`;
const details = `COALESCE((SELECT json_agg(json_build_object('id',t.id,'minQuantity',t.min_quantity::text,'pricePerUnitMinor',t.price_per_unit_minor::text,'pricePerUnit',(t.price_per_unit_minor::numeric/100)::text) ORDER BY t.min_quantity) FROM app.listing_price_tiers t WHERE t.listing_id=l.id),'[]') AS price_tiers,
 COALESCE((SELECT json_agg(json_build_object('id',i.id,'altText',i.alt_text,'width',i.width,'height',i.height) ORDER BY i.created_at,i.id) FROM app.listing_images i WHERE i.listing_id=l.id),'[]') AS images`;
async function sellerRole(user, org, runner = db) {
  const result = await runner.query(
    `SELECT m.role FROM app.organization_memberships m JOIN app.organizations o ON o.id=m.organization_id JOIN app.users u ON u.id=m.user_id
    WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND o.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL FOR SHARE OF m,o,u`,
    [user, org],
  );
  return result.rows[0]?.role;
}
async function isReviewer(user, runner = db) {
  const result = await runner.query(
    `SELECT 1 FROM app.platform_assignments p JOIN app.users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.role='platform_admin' AND u.status='active' AND u.email_verified_at IS NOT NULL FOR SHARE OF p,u`,
    [user],
  );
  return result.rowCount > 0;
}
async function audit(runner, user, org, id, action, reason = null) {
  await runner.query(
    `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason) VALUES($1,$2,$3,'listing',$4,$5)`,
    [user, org, action, id, reason],
  );
}
async function lockListing(runner, org, id) {
  const result = await runner.query(
    "SELECT * FROM app.listings WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [id, org],
  );
  if (!result.rowCount)
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing unavailable");
  return result.rows[0];
}
async function replaceTiers(runner, id, tiers) {
  await runner.query(
    "DELETE FROM app.listing_price_tiers WHERE listing_id=$1",
    [id],
  );
  for (const tier of tiers)
    await runner.query(
      `INSERT INTO app.listing_price_tiers(listing_id,min_quantity,price_per_unit_minor) VALUES($1,$2,$3)`,
      [id, tier.minQuantity, scaled(tier.pricePerUnit, 2).toString()],
    );
}
function fields(input) {
  return [
    input.title,
    input.description,
    input.material,
    input.condition,
    input.unit,
    input.quantity,
    input.minOrderQuantity,
    input.pricePerUnit,
    input.color,
    input.composition,
    input.location,
  ];
}
async function createListing(runner, org, user, input) {
  const result = await runner.query(
    `INSERT INTO app.listings(organization_id,created_by,title,description,material,condition,unit,quantity,min_order_quantity,price_per_unit,color,composition,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [org, user, ...fields(input)],
  );
  await replaceTiers(runner, result.rows[0].id, input.priceTiers);
  return result.rows[0];
}
async function editListing(runner, org, id, input, version) {
  const result = await runner.query(
    `UPDATE app.listings SET title=$3,description=$4,material=$5,condition=$6,unit=$7,quantity=$8,min_order_quantity=$9,price_per_unit=$10,color=$11,composition=$12,location=$13,review_reason=NULL WHERE id=$1 AND organization_id=$2 AND version=$14 RETURNING *`,
    [id, org, ...fields(input), version],
  );
  if (!result.rowCount)
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      "Stock changed. Reload before saving.",
    );
  await replaceTiers(runner, id, input.priceTiers);
  return result.rows[0];
}
async function setListingStatus(runner, id, status, reason = null) {
  return (
    await runner.query(
      "UPDATE app.listings SET status=$2,review_reason=$3 WHERE id=$1 RETURNING *",
      [id, status, reason],
    )
  ).rows[0];
}
async function listSeller(org) {
  return (
    await db.query(
      `SELECT l.*,${details} FROM app.listings l WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
      [org],
    )
  ).rows;
}
async function listPending() {
  return (
    await db.query(
      `SELECT l.*,o.name AS organization_name,${details} FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE l.status='pending_review' AND o.status='active' ORDER BY l.created_at,l.id LIMIT 100`,
    )
  ).rows;
}
async function publicListing(id) {
  return (
    await db.query(
      `SELECT ${publicColumns},${details} FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE l.id=$1 AND l.status='published' AND o.status='active'`,
      [id],
    )
  ).rows[0];
}
async function search(filters) {
  const clauses = ["l.status='published'", "o.status='active'"];
  const args = [];
  if (filters.q) {
    args.push(filters.q);
    clauses.push(
      `to_tsvector('simple',l.title || ' ' || l.description || ' ' || l.material) @@ plainto_tsquery('simple',$${args.length})`,
    );
  }
  if (filters.material) {
    args.push(filters.material);
    clauses.push(`lower(l.material)=lower($${args.length})`);
  }
  if (filters.unit) {
    args.push(filters.unit);
    clauses.push(`l.unit=$${args.length}`);
  }
  const orders = {
    newest: "l.created_at DESC,l.id DESC",
    price_asc: "l.price_per_unit_minor ASC,l.id DESC",
    price_desc: "l.price_per_unit_minor DESC,l.id DESC",
  };
  const where = clauses.join(" AND ");
  return db.transaction(async (runner) => {
    await runner.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const count = await runner.query(
      `SELECT count(*)::int AS total FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE ${where}`,
      args,
    );
    const rows = await runner.query(
      `SELECT ${publicColumns},${details} FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE ${where} ORDER BY ${orders[filters.sort]} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, filters.limit, (filters.page - 1) * filters.limit],
    );
    return {
      items: rows.rows,
      total: count.rows[0].total,
      page: filters.page,
      limit: filters.limit,
    };
  });
}
async function requirements(user) {
  return (
    await db.query(
      "SELECT * FROM app.buyer_requirements WHERE buyer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [user],
    )
  ).rows;
}
async function createRequirement(runner, user, input) {
  return (
    await runner.query(
      `INSERT INTO app.buyer_requirements(buyer_id,material,min_quantity,unit,max_price_per_unit,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        user,
        input.material,
        input.minQuantity,
        input.unit,
        input.maxPricePerUnit || null,
        input.notes || null,
      ],
    )
  ).rows[0];
}
async function lockRequirement(runner, user, id) {
  return (
    await runner.query(
      "SELECT * FROM app.buyer_requirements WHERE id=$1 AND buyer_id=$2 FOR UPDATE",
      [id, user],
    )
  ).rows[0];
}
async function setRequirementStatus(runner, id, status) {
  return (
    await runner.query(
      "UPDATE app.buyer_requirements SET status=$2 WHERE id=$1 RETURNING *",
      [id, status],
    )
  ).rows[0];
}
async function matches(user, id) {
  const result = await db.query(
    "SELECT * FROM app.buyer_requirements WHERE id=$1 AND buyer_id=$2 AND status='active'",
    [id, user],
  );
  const r = result.rows[0];
  if (!r)
    throw new AppError(
      404,
      "REQUIREMENT_NOT_FOUND",
      "Active requirement unavailable",
    );
  const matched = await db.query(
    `SELECT ${publicColumns},price.effective_minor::text AS matched_price_minor,(price.effective_minor::numeric/100)::text AS matched_price_per_unit,($2::numeric>=l.min_order_quantity) AS direct_purchase_eligible
    FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT t.price_per_unit_minor FROM app.listing_price_tiers t WHERE t.listing_id=l.id AND t.min_quantity <= $2::numeric ORDER BY t.min_quantity DESC LIMIT 1),l.price_per_unit_minor) AS effective_minor) price
    WHERE l.status='published' AND o.status='active' AND lower(l.material)=lower($1) AND l.unit=$3 AND l.quantity >= $2::numeric AND ($4::bigint IS NULL OR price.effective_minor <= $4::bigint)
    ORDER BY l.created_at DESC,l.id DESC LIMIT 50`,
    [r.material, r.min_quantity, r.unit, r.max_price_per_unit_minor],
  );
  return {
    requirement: r,
    items: matched.rows,
    explanation:
      "Same material and unit, enough active seller stock, and within your price ceiling using the tier for your quantity. MOQ eligibility is shown separately; checkout is not available yet.",
  };
}
async function imageCount(runner, id) {
  return (
    await runner.query(
      "SELECT count(*)::int AS total FROM app.listing_images WHERE listing_id=$1",
      [id],
    )
  ).rows[0].total;
}
async function insertImage(runner, id, key, alt, image) {
  return (
    await runner.query(
      `INSERT INTO app.listing_images(listing_id,object_key,alt_text,content_type,byte_size,width,height) VALUES($1,$2,$3,'image/webp',$4,$5,$6) RETURNING id,alt_text AS "altText",width,height`,
      [id, key, alt, image.buffer.length, image.width, image.height],
    )
  ).rows[0];
}
async function findImage(id, runner = db) {
  return (
    await runner.query(
      `SELECT i.*,l.organization_id,l.status,o.status AS organization_status FROM app.listing_images i JOIN app.listings l ON l.id=i.listing_id JOIN app.organizations o ON o.id=l.organization_id WHERE i.id=$1`,
      [id],
    )
  ).rows[0];
}
async function reviewListingLock(runner, id) {
  return (
    await runner.query("SELECT * FROM app.listings WHERE id=$1 FOR UPDATE", [
      id,
    ])
  ).rows[0];
}
async function activeOrganization(runner, org) {
  return (
    (
      await runner.query(
        "SELECT 1 FROM app.organizations WHERE id=$1 AND status='active' FOR SHARE",
        [org],
      )
    ).rowCount > 0
  );
}
async function requirementAudit(runner, user, id, action) {
  await runner.query(
    `INSERT INTO app.audit_events(actor_id,action,resource_type,resource_id) VALUES($1,$2,'requirement',$3)`,
    [user, action, id],
  );
}
async function bumpListing(runner, id) {
  await runner.query("UPDATE app.listings SET updated_at=now() WHERE id=$1", [
    id,
  ]);
}
async function queueImageCleanup(key, runner = db) {
  await runner.query(
    "INSERT INTO app.image_cleanup_jobs(object_key) VALUES($1) ON CONFLICT DO NOTHING",
    [key],
  );
}
async function removeImageRecord(runner, id) {
  await runner.query("DELETE FROM app.listing_images WHERE id=$1", [id]);
}
async function insertImportBatch(runner, org, user, key, hash, count) {
  return (
    (
      await runner.query(
        `INSERT INTO app.listing_import_batches(organization_id,created_by,request_key,payload_hash,listing_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,request_key) DO NOTHING RETURNING id`,
        [org, user, key, hash, count],
      )
    ).rowCount > 0
  );
}
async function importBatch(runner, org, key) {
  return (
    await runner.query(
      "SELECT payload_hash,listing_count FROM app.listing_import_batches WHERE organization_id=$1 AND request_key=$2",
      [org, key],
    )
  ).rows[0];
}
module.exports = {
  reviewListingLock,
  activeOrganization,
  requirementAudit,
  bumpListing,
  queueImageCleanup,
  removeImageRecord,
  insertImportBatch,
  importBatch,
  sellerRole,
  isReviewer,
  audit,
  lockListing,
  createListing,
  editListing,
  setListingStatus,
  listSeller,
  listPending,
  publicListing,
  search,
  requirements,
  createRequirement,
  lockRequirement,
  setRequirementStatus,
  matches,
  imageCount,
  insertImage,
  findImage,
};
