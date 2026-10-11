const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
// Never run destructive fixture setup against a user's project database.
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
const { signAccessToken, hashToken } = require("../src/lib/tokens");
const repo = require("../src/modules/catalog/repository");
const service = require("../src/modules/catalog/service");
const importer = require("../src/modules/catalog/importService");
const orgService = require("../src/services/organizationService");
let owner, buyer, other, admin, org, foreign, staff, listing, token;
const input = {
  title: "Integration cotton",
  description: "A clean cotton test fixture for tenant boundary verification.",
  material: "Cotton",
  condition: "Unused",
  unit: "kg",
  quantity: "100",
  minOrderQuantity: "10",
  pricePerUnit: "100.29",
  color: "",
  composition: "",
  location: "",
  priceTiers: [{ minQuantity: "50", pricePerUnit: "90.01" }],
};
async function user(name) {
  return (
    await db.query(
      "INSERT INTO app.users(email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'active',now()) RETURNING id",
      [
        `${name}-${crypto.randomUUID()}@example.invalid`,
        name,
        await bcrypt.hash("IntegrationPassword123", 4),
      ],
    )
  ).rows[0].id;
}
async function bearer(id) {
  const session = (
    await db.query(
      "INSERT INTO app.sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id",
      [id, hashToken(crypto.randomUUID())],
    )
  ).rows[0].id;
  return signAccessToken({ id }, session);
}
test.before(async () => {
  owner = await user("owner");
  buyer = await user("buyer");
  other = await user("other");
  admin = await user("admin");
  staff = await user("staff");
  org = (
    await db.query(
      "INSERT INTO app.organizations(name,slug,created_by,status) VALUES('Test seller',$1,$2,'active') RETURNING id",
      [crypto.randomUUID(), owner],
    )
  ).rows[0].id;
  foreign = (
    await db.query(
      "INSERT INTO app.organizations(name,slug,created_by,status) VALUES('Other seller',$1,$2,'active') RETURNING id",
      [crypto.randomUUID(), other],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO app.organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'staff'),($4,$5,'owner')",
    [org, owner, staff, foreign, other],
  );
  await db.query(
    "INSERT INTO app.platform_assignments(user_id,role,granted_by) VALUES($1,'platform_admin',$1)",
    [admin],
  );
  token = await bearer(owner);
});
test("API seller → draft → review → public search → buyer tier match, with private drafts", async () => {
  const created = await request(app)
    .post(`/api/v1/organizations/${org}/listings`)
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  listing = created.body.data;
  assert.equal(listing.price_per_unit_minor, "10029");
  assert.equal(
    (await request(app).get(`/api/v1/listings/${listing.id}`)).status,
    404,
  );
  const submit = await request(app)
    .post(`/api/v1/organizations/${org}/listings/${listing.id}/submit`)
    .set("Authorization", `Bearer ${token}`)
    .send({ version: listing.version });
  assert.equal(submit.status, 200);
  listing = submit.body.data;
  const review = await request(app)
    .post(`/api/v1/platform/listings/${listing.id}/review`)
    .set("Authorization", `Bearer ${await bearer(admin)}`)
    .send({
      version: listing.version,
      decision: "published",
      reason: "Integration reviewed stock",
    });
  assert.equal(review.status, 200);
  listing = review.body.data;
  const publicResult = await request(app).get(
    "/api/v1/listings?material=Cotton",
  );
  assert.equal(publicResult.status, 200);
  assert.ok(
    publicResult.body.data.items.some((item) => item.id === listing.id),
  );
  const requirement = await service.createRequirement(buyer, {
    material: "Cotton",
    unit: "kg",
    minQuantity: "60",
    maxPricePerUnit: "91",
  });
  const matches = await repo.matches(buyer, requirement.id);
  assert.equal(matches.items[0].matched_price_minor, "9001");
  assert.equal(matches.items[0].direct_purchase_eligible, true);
});
test("wrong tenant, staff, and revoked membership cannot mutate stock", async () => {
  await assert.rejects(
    () => service.create(other, org, input),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () => service.create(staff, org, input),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () => service.transition(owner, org, crypto.randomUUID(), "archived", 1),
    (error) => error.status === 404,
  );
  await db.query(
    "UPDATE app.organization_memberships SET status='suspended' WHERE user_id=$1 AND organization_id=$2",
    [owner, org],
  );
  await assert.rejects(
    () => service.create(owner, org, input),
    (error) => error.status === 403,
  );
  await db.query(
    "UPDATE app.organization_memberships SET status='active' WHERE user_id=$1 AND organization_id=$2",
    [owner, org],
  );
});
test("suspending an organization removes its stock from detail, count and matching", async () => {
  await db.query(
    "UPDATE app.organizations SET status='suspended' WHERE id=$1",
    [org],
  );
  assert.equal(
    (await repo.search({ page: 1, limit: 12, sort: "newest" })).total,
    0,
  );
  await assert.rejects(
    () => service.publicListing(listing.id),
    (error) => error.status === 404,
  );
  const requirement = await service.createRequirement(buyer, {
    material: "Cotton",
    unit: "kg",
    minQuantity: "60",
  });
  assert.equal((await repo.matches(buyer, requirement.id)).items.length, 0);
  await db.query("UPDATE app.organizations SET status='active' WHERE id=$1", [
    org,
  ]);
});
test("concurrent imports with one key create one batch; changed replay has no effect", async () => {
  const requestKey = crypto.randomUUID();
  const results = await Promise.all([
    importer.commit(owner, org, { requestKey, rows: [input] }),
    importer.commit(owner, org, { requestKey, rows: [input] }),
  ]);
  assert.equal(results.filter((item) => item.duplicate).length, 1);
  const count = await db.query(
    "SELECT count(*)::int AS n FROM app.listing_import_batches WHERE request_key=$1",
    [requestKey],
  );
  assert.equal(count.rows[0].n, 1);
  await assert.rejects(
    () =>
      importer.commit(owner, org, {
        requestKey,
        rows: [{ ...input, title: "Changed payload" }],
      }),
    (error) => error.code === "IMPORT_KEY_REUSED",
  );
});
test("simultaneous stale edits have one winner and preserve coherent tiers", async () => {
  const draft = await service.create(owner, org, input);
  const results = await Promise.allSettled([
    service.edit(
      owner,
      org,
      draft.id,
      { ...input, title: "Edit A" },
      draft.version,
    ),
    service.edit(
      owner,
      org,
      draft.id,
      { ...input, title: "Edit B" },
      draft.version,
    ),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(
    results.find((item) => item.status === "rejected").reason.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM app.listing_price_tiers WHERE listing_id=$1",
        [draft.id],
      )
    ).rows[0].n,
    1,
  );
});
test("requirement ownership, pause, resume and terminal close are enforced", async () => {
  let r = await service.createRequirement(buyer, {
    material: "Cotton",
    unit: "kg",
    minQuantity: "20",
  });
  await assert.rejects(
    () => service.requirementStatus(other, r.id, "paused", r.version),
    (error) => error.status === 404,
  );
  r = await service.requirementStatus(buyer, r.id, "paused", r.version);
  await assert.rejects(
    () => repo.matches(buyer, r.id),
    (error) => error.status === 404,
  );
  r = await service.requirementStatus(buyer, r.id, "active", r.version);
  r = await service.requirementStatus(buyer, r.id, "closed", r.version);
  await assert.rejects(
    () => service.requirementStatus(buyer, r.id, "active", r.version),
    (error) => error.status === 409,
  );
});
test("logout revokes an existing access token immediately", async () => {
  const refresh = "integration-refresh-" + crypto.randomUUID();
  const session = (
    await db.query(
      "INSERT INTO app.sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id",
      [buyer, hashToken(refresh)],
    )
  ).rows[0].id;
  const access = signAccessToken({ id: buyer }, session);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/requirements")
        .set("Authorization", `Bearer ${access}`)
    ).status,
    200,
  );
  const logout = await request(app)
    .post("/api/v1/auth/logout")
    .set("Origin", "http://localhost:3000")
    .set("X-ReSourcePK-CSRF", "1")
    .set("Cookie", `refresh_token=${refresh}`);
  assert.equal(logout.status, 204);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/requirements")
        .set("Authorization", `Bearer ${access}`)
    ).status,
    401,
  );
});
test("expired/reused invitations, revoked inviters and Owner role replacement are rejected", async () => {
  const email = (
    await db.query("SELECT email FROM app.users WHERE id=$1", [buyer])
  ).rows[0].email;
  async function invite(expiry = "1 hour", who = email) {
    const raw = crypto.randomUUID() + crypto.randomUUID();
    await db.query(
      `INSERT INTO app.organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at,created_at) VALUES($1,$2,'staff',$3,$4,now()+$5::interval,now()-interval '2 hours')`,
      [org, who, hashToken(raw), owner, expiry],
    );
    return raw;
  }
  const expired = await invite("-1 hour");
  await assert.rejects(
    () => orgService.acceptExistingUser(buyer, expired, {}),
    (error) => error.status === 400,
  );
  const raw = await invite();
  await orgService.acceptExistingUser(buyer, raw, {});
  await assert.rejects(
    () => orgService.acceptExistingUser(buyer, raw, {}),
    (error) => error.status === 400,
  );
  const revoked = await invite();
  await db.query(
    "UPDATE app.organization_memberships SET status='suspended' WHERE user_id=$1 AND organization_id=$2",
    [owner, org],
  );
  await assert.rejects(
    () => orgService.acceptExistingUser(buyer, revoked, {}),
    (error) => error.status === 403,
  );
  await db.query(
    "UPDATE app.organization_memberships SET status='active' WHERE user_id=$1 AND organization_id=$2",
    [owner, org],
  );
  const ownerEmail = (
    await db.query("SELECT email FROM app.users WHERE id=$1", [owner])
  ).rows[0].email;
  const ownerInvite = await invite("1 hour", ownerEmail);
  await assert.rejects(
    () => orgService.acceptExistingUser(owner, ownerInvite, {}),
    (error) => error.code === "OWNER_ROLE_PROTECTED",
  );
});
test("archiving hides published stock without deleting the audit record", async () => {
  const archived = await service.transition(
    owner,
    org,
    listing.id,
    "archived",
    listing.version,
  );
  assert.equal(archived.status, "archived");
  await assert.rejects(
    () => service.publicListing(listing.id),
    (error) => error.status === 404,
  );
  assert.ok(
    (
      await db.query(
        "SELECT 1 FROM app.audit_events WHERE resource_id=$1 AND action='listing.archived'",
        [listing.id],
      )
    ).rowCount,
  );
});

test("paginated seller, reviewer and buyer collections preserve scope and reject unknown queries", async () => {
  const own = await service.listSeller(owner, org, { page: 1, limit: 1 });
  assert.equal(own.limit, 1);
  assert.equal(own.items.length, 1);
  assert.ok(own.total > own.items.length);
  assert.ok(own.items.every((item) => item.organization_id === org));
  const second = await service.listSeller(owner, org, { page: 2, limit: 1 });
  assert.notEqual(second.items[0].id, own.items[0].id);
  await assert.rejects(
    () => service.listSeller(other, org, { page: 1, limit: 1 }),
    (error) => error.status === 403,
  );
  const requirements = await repo.requirements(buyer, { page: 1, limit: 1 });
  assert.ok(requirements.total >= 3);
  assert.equal(requirements.items.length, 1);
  assert.equal(requirements.items[0].buyer_id, buyer);
  assert.equal(
    (await repo.requirements(other, { page: 1, limit: 1 })).total,
    0,
  );
  const draft = await service.create(owner, org, input);
  await service.transition(
    owner,
    org,
    draft.id,
    "pending_review",
    draft.version,
  );
  const pending = await service.pending(admin, { page: 1, limit: 1 });
  assert.ok(pending.items.every((item) => item.status === "pending_review"));
  await assert.rejects(
    () => service.pending(buyer, { page: 1, limit: 1 }),
    (error) => error.status === 403,
  );
  for (const query of ["page=0", "limit=51", "buyerId=" + other]) {
    assert.equal(
      (
        await request(app)
          .get(`/api/v1/requirements?${query}`)
          .set("Authorization", `Bearer ${await bearer(buyer)}`)
      ).status,
      422,
    );
  }
});
test("image metadata, capability access and deferred cleanup follow the listing lifecycle", async (t) => {
  const images = require("../src/modules/catalog/imageAdapter");
  const sharp = require("sharp");
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const uploaded = [];
  t.mock.method(images, "upload", async (key, image) => {
    uploaded.push(key);
    assert.equal((await sharp(image.buffer).metadata()).format, "webp");
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM app.image_cleanup_jobs WHERE object_key=$1",
          [key],
        )
      ).rowCount,
      1,
    );
  });
  t.mock.method(
    images,
    "signedUrl",
    async () => "https://storage.example.invalid/test-capability",
  );
  const draft = await service.create(owner, org, input);
  const image = await service.addImage(
    owner,
    org,
    draft.id,
    { buffer },
    "Synthetic cotton swatch",
    draft.version,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.image_cleanup_jobs WHERE object_key=$1",
        [uploaded[0]],
      )
    ).rowCount,
    0,
  );
  await assert.rejects(
    () => service.imageUrl(null, image.id),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => service.imageUrl(other, image.id),
    (error) => error.status === 403,
  );
  assert.equal((await service.imageUrl(owner, image.id)).expiresIn, 60);
  assert.equal((await service.imageUrl(admin, image.id)).expiresIn, 60);
  const current = (
    await db.query("SELECT version FROM app.listings WHERE id=$1", [draft.id])
  ).rows[0];
  await service.deleteImage(owner, org, draft.id, image.id, current.version);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.image_cleanup_jobs WHERE object_key=$1",
        [uploaded[0]],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM app.listing_images WHERE id=$1", [image.id]))
      .rowCount,
    0,
  );
  const cleanup = require("../src/modules/catalog/imageCleanupService");
  const removals = [];
  t.mock.method(images, "remove", async (key) => removals.push(key));
  await cleanup.cleanImageObjects();
  assert.equal(removals.length, 0, "fresh recovery jobs have a grace period");
  await db.query(
    "UPDATE app.image_cleanup_jobs SET created_at=now()-interval '3 minutes' WHERE object_key=$1",
    [uploaded[0]],
  );
  assert.equal((await cleanup.cleanImageObjects()).removed, 1);
  assert.deepEqual(removals, uploaded);
});
test("ambiguous storage timeout preserves recovery without creating image metadata", async (t) => {
  const images = require("../src/modules/catalog/imageAdapter");
  const sharp = require("sharp");
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  let key;
  t.mock.method(images, "upload", async (objectKey) => {
    key = objectKey;
    throw new Error("Provider acknowledgement timeout");
  });
  const draft = await service.create(owner, org, input);
  await assert.rejects(() =>
    service.addImage(
      owner,
      org,
      draft.id,
      { buffer },
      "Synthetic swatch",
      draft.version,
    ),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.image_cleanup_jobs WHERE object_key=$1",
        [key],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM app.listing_images WHERE listing_id=$1", [
        draft.id,
      ])
    ).rowCount,
    0,
  );
  await db.query(
    "UPDATE app.image_cleanup_jobs SET created_at=now()-interval '3 minutes' WHERE object_key=$1",
    [key],
  );
  t.mock.method(images, "remove", async () => {
    throw new Error("Provider unavailable");
  });
  const cleanup = require("../src/modules/catalog/imageCleanupService");
  assert.equal((await cleanup.cleanImageObjects()).failed, 1);
  assert.equal(
    (
      await db.query(
        "SELECT attempts FROM app.image_cleanup_jobs WHERE object_key=$1",
        [key],
      )
    ).rows[0].attempts,
    1,
  );
});
test.after(() => db.pool.end());
