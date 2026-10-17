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
)
  throw new Error(
    "TEST_DATABASE_URL must target a dedicated local resourcepk_test_* database",
  );
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET =
  "integration-only-secret-with-at-least-thirty-two-characters";

const db = require("../src/db");
const app = require("../src/app");
const purchases = require("../src/modules/purchases/service");
const { signAccessToken, hashToken } = require("../src/lib/tokens");

let owner;
let manager;
let staff;
let buyer;
let secondBuyer;
let replacementBuyer;
let organization;
let ownerToken;
let managerToken;
let staffToken;
let buyerToken;
let secondBuyerToken;
let replacementBuyerToken;
const listingIds = [];

async function createUser(roleLabel) {
  const result = await db.query(
    `INSERT INTO app.users(email,full_name,password_hash,status,email_verified_at)
     VALUES($1,$2,$3,'active',now()) RETURNING id`,
    [
      `${roleLabel}-${crypto.randomUUID()}@example.invalid`,
      `Purchase ${roleLabel}`,
      await bcrypt.hash("IntegrationPassword123", 4),
    ],
  );
  return result.rows[0].id;
}

async function tokenFor(userId) {
  const result = await db.query(
    `INSERT INTO app.sessions(user_id,refresh_token_hash,expires_at)
     VALUES($1,$2,now()+interval '1 day') RETURNING id`,
    [userId, hashToken(crypto.randomUUID())],
  );
  return signAccessToken({ id: userId }, result.rows[0].id);
}

async function createListing({ quantity = "100", purchaseMode = "both" } = {}) {
  const result = await db.query(
    `INSERT INTO app.listings(
       organization_id,created_by,title,description,material,condition,unit,
       quantity,min_order_quantity,price_per_unit,status,purchase_mode
     ) VALUES($1,$2,$3,$4,'Cotton','Unused','kg',$5,10,100.29,'published',$6)
     RETURNING id`,
    [
      organization,
      owner,
      `Purchase listing ${crypto.randomUUID()}`,
      "A synthetic published listing for purchase integration coverage.",
      quantity,
      purchaseMode,
    ],
  );
  const listingId = result.rows[0].id;
  listingIds.push(listingId);
  await db.query(
    `INSERT INTO app.listing_price_tiers(listing_id,min_quantity,price_per_unit_minor)
     VALUES($1,25,9001)`,
    [listingId],
  );
  return listingId;
}

function requestKey() {
  return crypto.randomUUID();
}

function closeTime() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

async function createGroup(listingId, targetQuantity) {
  const response = await request(app)
    .post(`/api/v1/organizations/${organization}/purchase-groups`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      listingId,
      targetQuantity,
      closesAt: closeTime(),
      requestKey: requestKey(),
    });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}

async function joinGroup(groupId, token, quantity) {
  return request(app)
    .post(`/api/v1/purchase-groups/${groupId}/contributions`)
    .set("Authorization", `Bearer ${token}`)
    .send({ quantity, requestKey: requestKey() });
}

async function rowForOrder(orderId) {
  const result = await db.query(
    `SELECT o.*,r.status AS reservation_status,r.quantity AS reserved_quantity,
       r.release_reason
     FROM app.orders o JOIN app.inventory_reservations r ON r.order_id=o.id
     WHERE o.id=$1`,
    [orderId],
  );
  return result.rows[0];
}

test.before(async () => {
  owner = await createUser("owner");
  manager = await createUser("manager");
  staff = await createUser("staff");
  buyer = await createUser("buyer");
  secondBuyer = await createUser("second-buyer");
  replacementBuyer = await createUser("replacement-buyer");
  const organizationResult = await db.query(
    `INSERT INTO app.organizations(name,slug,created_by,status)
     VALUES('Purchase Test Mill',$1,$2,'active') RETURNING id`,
    [crypto.randomUUID(), owner],
  );
  organization = organizationResult.rows[0].id;
  await db.query(
    `INSERT INTO app.organization_memberships(organization_id,user_id,role)
     VALUES($1,$2,'owner'),($1,$3,'manager'),($1,$4,'staff')`,
    [organization, owner, manager, staff],
  );
  [
    ownerToken,
    managerToken,
    staffToken,
    buyerToken,
    secondBuyerToken,
    replacementBuyerToken,
  ] = await Promise.all([
    tokenFor(owner),
    tokenFor(manager),
    tokenFor(staff),
    tokenFor(buyer),
    tokenFor(secondBuyer),
    tokenFor(replacementBuyer),
  ]);
});

test("direct orders reserve stock, snapshot tier pricing, and honor idempotency", async () => {
  const listingId = await createListing();
  const key = requestKey();
  const body = { listingId, quantity: "30", requestKey: key };
  const first = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send(body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.status, "pending_seller_confirmation");
  assert.equal(first.body.data.unit_price_minor, "9001");
  assert.equal(first.body.data.total_minor, "270030");

  const replay = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send(body);
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.data.id, first.body.data.id);
  const saved = await rowForOrder(first.body.data.id);
  assert.equal(saved.reservation_status, "active");
  assert.equal(saved.reserved_quantity, "30.000");

  const changedReplay = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({ ...body, quantity: "31" });
  assert.equal(changedReplay.status, 409);
  assert.equal(changedReplay.body.error.code, "IDEMPOTENCY_KEY_REUSED");
});

test("direct Seller decisions enforce Manager grants and release rejected stock", async () => {
  const listingId = await createListing();
  const placed = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({ listingId, quantity: "10", requestKey: requestKey() });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.data.id;

  const denied = await request(app)
    .post(`/api/v1/organizations/${organization}/orders/${orderId}/decision`)
    .set("Authorization", `Bearer ${managerToken}`)
    .send({ decision: "confirm" });
  assert.equal(denied.status, 403);

  const rejected = await request(app)
    .post(`/api/v1/organizations/${organization}/orders/${orderId}/decision`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ decision: "reject", reason: "Seller cannot fulfil this share" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.data.status, "rejected");
  const saved = await rowForOrder(orderId);
  assert.equal(saved.reservation_status, "released");
  assert.equal(saved.release_reason, "seller_rejected");
});

test("an unanswered direct order expires and releases its reservation", async () => {
  const listingId = await createListing();
  const placed = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({ listingId, quantity: "10", requestKey: requestKey() });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  await db.query(
    `UPDATE app.orders SET created_at=now()-interval '2 hours',
       seller_response_due_at=now()-interval '1 hour' WHERE id=$1`,
    [placed.body.data.id],
  );

  const expiry = await purchases.expireDueOrders();
  assert.ok(expiry.sellerExpired >= 1);
  const saved = await rowForOrder(placed.body.data.id);
  assert.equal(saved.status, "seller_expired");
  assert.equal(saved.reservation_status, "released");
  assert.equal(saved.release_reason, "seller_timeout");
});

test("group shares respect stock/target, lock each share price, and require Seller permission", async () => {
  const listingId = await createListing();
  const group = await createGroup(listingId, "50");
  const first = await joinGroup(group.id, buyerToken, "20");
  const second = await joinGroup(group.id, secondBuyerToken, "30");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(first.body.data.unit_price_minor, "10029");
  assert.equal(first.body.data.total_minor, "200580");
  assert.equal(second.body.data.unit_price_minor, "9001");
  assert.equal(second.body.data.total_minor, "270030");

  const overshoot = await joinGroup(group.id, replacementBuyerToken, "1");
  assert.equal(overshoot.status, 409);
  assert.equal(overshoot.body.error.code, "GROUP_TARGET_EXCEEDED");

  const denied = await request(app)
    .post(
      `/api/v1/organizations/${organization}/purchase-groups/${group.id}/decision`,
    )
    .set("Authorization", `Bearer ${managerToken}`)
    .send({ decision: "confirm" });
  assert.equal(denied.status, 403);

  const membership = await db.query(
    `SELECT id FROM app.organization_memberships
     WHERE organization_id=$1 AND user_id=$2 AND role='manager'`,
    [organization, manager],
  );
  const grant = await request(app)
    .patch(
      `/api/v1/organizations/${organization}/managers/${membership.rows[0].id}/permissions`,
    )
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ permissions: ["orders.confirm"] });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));

  const confirmed = await request(app)
    .post(
      `/api/v1/organizations/${organization}/purchase-groups/${group.id}/decision`,
    )
    .set("Authorization", `Bearer ${managerToken}`)
    .send({ decision: "confirm" });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.status, "payment_open");
  const participants = await db.query(
    "SELECT status,payment_due_at,seller_confirmed_at FROM app.orders WHERE group_id=$1 ORDER BY quantity",
    [group.id],
  );
  assert.equal(participants.rowCount, 2);
  assert.ok(participants.rows.every((row) => row.status === "pending_payment"));
  assert.ok(participants.rows.every((row) => row.payment_due_at));
  assert.ok(participants.rows.every((row) => row.seller_confirmed_at));

  const staffDenied = await request(app)
    .post(
      `/api/v1/organizations/${organization}/purchase-groups/${group.id}/decision`,
    )
    .set("Authorization", `Bearer ${staffToken}`)
    .send({ decision: "confirm" });
  assert.equal(staffDenied.status, 403);
});

test("a Buyer can leave an unconfirmed group and free the reserved share", async () => {
  const listingId = await createListing();
  const group = await createGroup(listingId, "30");
  const joined = await joinGroup(group.id, buyerToken, "20");
  assert.equal(joined.status, 201, JSON.stringify(joined.body));

  const left = await request(app)
    .post(
      `/api/v1/purchase-groups/${group.id}/contributions/${joined.body.data.id}/leave`,
    )
    .set("Authorization", `Bearer ${buyerToken}`);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.data.status, "withdrawn");
  const saved = await rowForOrder(joined.body.data.id);
  assert.equal(saved.reservation_status, "released");
  assert.equal(saved.release_reason, "buyer_withdrew");
});

test("payment timeout releases a group nonpayer and requires reconfirmation", async () => {
  const listingId = await createListing();
  const group = await createGroup(listingId, "10");
  const first = await joinGroup(group.id, buyerToken, "5");
  const second = await joinGroup(group.id, secondBuyerToken, "5");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const confirmed = await request(app)
    .post(
      `/api/v1/organizations/${organization}/purchase-groups/${group.id}/decision`,
    )
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ decision: "confirm" });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  await db.query(
    `UPDATE app.orders SET seller_confirmed_at=now()-interval '73 hours',
       payment_due_at=now()-interval '1 hour' WHERE id=$1`,
    [first.body.data.id],
  );
  const expiry = await purchases.expireDueOrders();
  assert.ok(expiry.paymentExpired >= 1);
  const expired = await rowForOrder(first.body.data.id);
  assert.equal(expired.status, "payment_expired");
  assert.equal(expired.reservation_status, "released");
  const reopened = await rowForOrder(second.body.data.id);
  assert.equal(reopened.status, "group_open");
  assert.equal(reopened.reservation_status, "active");
  const groupState = await db.query(
    "SELECT status FROM app.purchase_groups WHERE id=$1",
    [group.id],
  );
  assert.equal(groupState.rows[0].status, "reconfirmation_required");

  const replacement = await joinGroup(group.id, replacementBuyerToken, "5");
  assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  const reconfirmed = await request(app)
    .post(
      `/api/v1/organizations/${organization}/purchase-groups/${group.id}/decision`,
    )
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ decision: "confirm" });
  assert.equal(reconfirmed.status, 200, JSON.stringify(reconfirmed.body));
  const unpaid = await db.query(
    "SELECT status FROM app.orders WHERE group_id=$1 AND status='pending_payment'",
    [group.id],
  );
  assert.equal(unpaid.rowCount, 2);
});

test("concurrent direct orders cannot reserve more stock than a listing has", async () => {
  const listingId = await createListing({ quantity: "50" });
  const requests = [buyerToken, secondBuyerToken].map((authorization) =>
    request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${authorization}`)
      .send({ listingId, quantity: "30", requestKey: requestKey() }),
  );
  const results = await Promise.all(requests);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const reservations = await db.query(
    `SELECT COALESCE(sum(quantity),0)::text AS quantity
     FROM app.inventory_reservations WHERE listing_id=$1 AND status='active'`,
    [listingId],
  );
  assert.equal(reservations.rows[0].quantity, "30.000");
});

test.after(async () => {
  if (listingIds.length)
    await db.query(
      "UPDATE app.listings SET status='archived' WHERE id=ANY($1::uuid[])",
      [listingIds],
    );
  await db.pool.end();
});
