
const crypto = require("node:crypto");
const { buildPassportPayload } = require("./passportPayload");
const { canonicalize, hashPassport } = require("./canonical");

async function createSnapshotForOrder(tx, orderId) {
  if (!tx || typeof tx.query !== "function") {
    throw new TypeError("A valid transaction client is required");
  }

  if (!orderId || typeof orderId !== "string") {
    throw new TypeError("A valid orderId is required");
  }

  // Load the order and its listing.
  const result = await tx.query(
    `SELECT
       o.id,
       o.listing_id,
       o.quantity,
       o.unit,
       o.completed_at,
       o.fulfilment_status,
       l.material,
       l.composition,
       l.color,
       l.condition
     FROM app.orders o
     JOIN app.listings l ON l.id = o.listing_id
     WHERE o.id = $1
     FOR UPDATE OF o`,
    [orderId],
  );

  if (result.rows.length === 0) {
    throw new Error("Order or its listing was not found");
  }

  const { fulfilment_status, ...orderAndListing } = result.rows[0];

  if (fulfilment_status !== "completed") {
    throw new Error("Cannot create a passport for an incomplete order");
  }

  // Generate the passport ID and build its payload.
  const passportId = crypto.randomUUID();

  const payload = buildPassportPayload({
    passportId,
    version: 1,
    order: orderAndListing,
    listing: orderAndListing,
  });

  // Generate canonical JSON and its SHA-256 hash.
  const canonicalJson = canonicalize(payload);
  const passportHash = hashPassport(canonicalJson);

  // Insert the first version. A replay must not create a duplicate.
  const insertResult = await tx.query(
    `INSERT INTO app.passport_snapshots (
       id,
       order_id,
       version,
       canonical_json,
       snapshot_data,
       passport_hash
     )
     VALUES ($1, $2, 1, $3, $4, $5)
     ON CONFLICT (order_id, version) DO NOTHING
     RETURNING *`,
    [
      passportId,
      orderId,
      canonicalJson,
      payload,
      passportHash,
    ],
  );

  if (insertResult.rows.length > 0) {
    return insertResult.rows[0];
  }

  // If the snapshot already exists, return the existing record.
  const existingResult = await tx.query(
    `SELECT *
     FROM app.passport_snapshots
     WHERE order_id = $1 AND version = 1`,
    [orderId],
  );

  if (existingResult.rows.length === 0) {
    throw new Error("Snapshot insert did not create or find a record");
  }

  return existingResult.rows[0];
}

module.exports = { createSnapshotForOrder };
