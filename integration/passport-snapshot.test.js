const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

const url = new URL(
  process.env.TEST_DATABASE_URL || "postgresql://invalid/invalid",
);

if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.startsWith("/resourcepk_test_")
) {
  throw new Error(
    "TEST_DATABASE_URL must target a dedicated local resourcepk_test_* database",
  );
}

process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET =
  "integration-only-secret-with-at-least-thirty-two-characters";

const db = require("../src/db");
const app = require("../src/app");
const { signAccessToken, hashToken } = require("../src/lib/tokens");

let owner;
let buyer;
let organization;
let ownerToken;
let buyerToken;
const listingIds = [];

async function createUser(label) {
  const result = await db.query(
    `INSERT INTO app.users
      (email, full_name, password_hash, status, email_verified_at)
     VALUES ($1, $2, $3, 'active', now())
     RETURNING id`,
    [
      `${label}-${crypto.randomUUID()}@example.invalid`,
      `Snapshot ${label}`,
      await bcrypt.hash("IntegrationPassword123", 4),
    ],
  );

  return result.rows[0].id;
}

async function tokenFor(userId) {
  const result = await db.query(
    `INSERT INTO app.sessions
      (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 day')
     RETURNING id`,
    [userId, hashToken(crypto.randomUUID())],
  );

  return signAccessToken({ id: userId }, result.rows[0].id);
}

async function createListing() {
  const result = await db.query(
    `INSERT INTO app.listings(
       organization_id, created_by, title, description,
       material, condition, unit, quantity,
       min_order_quantity, price_per_unit, status, purchase_mode
     )
     VALUES (
       $1, $2, $3, $4,
       'Cotton', 'Unused', 'kg', '100',
       10, 100.29, 'published', 'both'
     )
     RETURNING id`,
    [
      organization,
      owner,
      `Snapshot listing ${crypto.randomUUID()}`,
      "Synthetic listing for passport snapshot integration testing.",
    ],
  );

  const listingId = result.rows[0].id;
  listingIds.push(listingId);

  await db.query(
    `INSERT INTO app.listing_price_tiers
       (listing_id, min_quantity, price_per_unit_minor)
     VALUES ($1, 10, 10029)`,
    [listingId],
  );

  return listingId;
}

async function prepareDispatchedOrder() {
  const listingId = await createListing();

  const placed = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({
      listingId,
      quantity: "10",
      requestKey: crypto.randomUUID(),
    });

  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const orderId = placed.body.data.id;

  const confirmed = await request(app)
    .post(`/api/v1/organizations/${organization}/orders/${orderId}/decision`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ decision: "confirm" });

  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  // Simulate successful payment and dispatch without using the gateway.
  await db.query(
    `UPDATE app.orders
     SET status = 'paid', paid_at = NOW(), fulfilment_status = 'dispatched'
     WHERE id = $1`,
    [orderId],
  );

  return orderId;
}

test.before(async () => {
  owner = await createUser("owner");
  buyer = await createUser("buyer");

  const result = await db.query(
    `INSERT INTO app.organizations(name, slug, created_by, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    ["Snapshot Test Mill", crypto.randomUUID(), owner],
  );

  organization = result.rows[0].id;

  await db.query(
    `INSERT INTO app.organization_memberships
       (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organization, owner],
  );

  ownerToken = await tokenFor(owner);
  buyerToken = await tokenFor(buyer);
});

test("receipt confirmation creates one immutable passport snapshot", async () => {
  const orderId = await prepareDispatchedOrder();

  const response = await request(app)
    .post(`/api/v1/orders/${orderId}/confirm-receipt`)
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({});

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.fulfilment_status, "completed");

  const result = await db.query(
    `SELECT id, version, canonical_json, snapshot_data, passport_hash
     FROM app.passport_snapshots
     WHERE order_id = $1`,
    [orderId],
  );

  assert.equal(result.rowCount, 1);

  const snapshot = result.rows[0];

  assert.equal(snapshot.version, 1);
  assert.ok(snapshot.canonical_json);
  assert.ok(snapshot.snapshot_data);
  assert.ok(snapshot.passport_hash);

  const calculatedHash = crypto
    .createHash("sha256")
    .update(snapshot.canonical_json, "utf8")
    .digest("hex");

  assert.equal(
    snapshot.passport_hash.toLowerCase(),
    calculatedHash.toLowerCase(),
  );

  // Repeated confirmation must not create another snapshot.
  const repeated = await request(app)
    .post(`/api/v1/orders/${orderId}/confirm-receipt`)
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({});

  assert.equal(repeated.status, 200);

  const count = await db.query(
    "SELECT COUNT(*)::int AS total FROM app.passport_snapshots WHERE order_id = $1",
    [orderId],
  );

  assert.equal(count.rows[0].total, 1);

  // Snapshot data must be immutable.
  await assert.rejects(
    db.query(
      "UPDATE app.passport_snapshots SET passport_hash = 'tampered' WHERE id = $1",
      [snapshot.id],
    ),
    /immutable/i,
  );

  await assert.rejects(
    db.query("DELETE FROM app.passport_snapshots WHERE id = $1", [snapshot.id]),
    /cannot be deleted/i,
  );
});

test("snapshot creation failure rolls back order completion", async () => {
  const orderId = await prepareDispatchedOrder();

  await db.query(`
    CREATE OR REPLACE FUNCTION app.test_reject_snapshot_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'forced snapshot failure';
    END;
    $$;
  `);

  await db.query(`
    CREATE TRIGGER test_reject_snapshot_insert
    BEFORE INSERT ON app.passport_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION app.test_reject_snapshot_insert();
  `);

  try {
    const response = await request(app)
      .post(`/api/v1/orders/${orderId}/confirm-receipt`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({});

    assert.equal(response.status, 500, JSON.stringify(response.body));

    const result = await db.query(
      `SELECT fulfilment_status, completed_at
       FROM app.orders
       WHERE id = $1`,
      [orderId],
    );

    assert.equal(result.rows[0].fulfilment_status, "dispatched");
    assert.equal(result.rows[0].completed_at, null);

    const snapshots = await db.query(
      "SELECT COUNT(*)::int AS total FROM app.passport_snapshots WHERE order_id = $1",
      [orderId],
    );

    assert.equal(snapshots.rows[0].total, 0);
  } finally {
    await db.query(`
      DROP TRIGGER IF EXISTS test_reject_snapshot_insert
      ON app.passport_snapshots;
    `);

    await db.query(`
      DROP FUNCTION IF EXISTS app.test_reject_snapshot_insert();
    `);
  }
});

test.after(async () => {
  if (listingIds.length) {
    await db.query(
      "UPDATE app.listings SET status = 'archived' WHERE id = ANY($1::uuid[])",
      [listingIds],
    );
  }

  await db.pool.end();
});
