const bcrypt = require("bcryptjs");
const db = require("../src/db");
const { env } = require("../src/config/env");
const { strongPassword } = require("../src/lib/password");
const repo = require("../src/modules/catalog/repository");
const { listingInput } = require("../src/modules/catalog/validation");
const { suppliers, materials, fixtureListing } = require("./demo-fixtures");
async function record(runner, key, kind, id) {
  await runner.query(
    "INSERT INTO app.demo_seed_records(seed_key,kind,record_id) VALUES($1,$2,$3)",
    [key, kind, id],
  );
}
async function existing(runner, key) {
  return (
    await runner.query(
      "SELECT record_id FROM app.demo_seed_records WHERE seed_key=$1",
      [key],
    )
  ).rows[0]?.record_id;
}
async function account(runner, key, name, hash) {
  const known = await existing(runner, key);
  if (known) return known;
  const email = `${key}@resourcepk.example.invalid`;
  const result = await runner.query(
    `INSERT INTO app.users(email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'active',now()) ON CONFLICT(email) DO NOTHING RETURNING id`,
    [email, name, hash],
  );
  if (!result.rowCount)
    throw new Error(
      "A fixture email already belongs to an unmarked account. Seed aborted.",
    );
  const id = result.rows[0].id;
  await record(runner, key, "user", id);
  return id;
}
async function seed() {
  if (env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true")
    throw new Error(
      "Demo seed requires a non-production database and ALLOW_DEMO_SEED=true",
    );
  const password = strongPassword.parse(process.env.DEMO_PASSWORD);
  const hash = await bcrypt.hash(password, 12);
  await db.transaction(async (runner) => {
    await runner.query(
      "SELECT pg_advisory_xact_lock(hashtext('resourcepk-demo-seed-v1'))",
    );
    const admin = await account(
      runner,
      "demo-admin",
      "Demo Platform Reviewer",
      hash,
    );
    await account(runner, "demo-buyer", "Demo Buyer", hash);
    await runner.query(
      "INSERT INTO app.platform_assignments(user_id,role,granted_by) VALUES($1,'platform_admin',$1) ON CONFLICT(user_id,role) DO NOTHING",
      [admin],
    );
    for (let supplier = 0; supplier < suppliers.length; supplier++) {
      const owner = await account(
        runner,
        `demo-owner-${supplier + 1}`,
        `Demo Owner ${supplier + 1}`,
        hash,
      );
      const orgKey = `demo-organization-${supplier + 1}`;
      let org = await existing(runner, orgKey);
      if (!org) {
        const result = await runner.query(
          `INSERT INTO app.organizations(name,slug,created_by,status) VALUES($1,$2,$3,'active') RETURNING id`,
          [suppliers[supplier], orgKey, owner],
        );
        org = result.rows[0].id;
        await record(runner, orgKey, "organization", org);
        await runner.query(
          "INSERT INTO app.organization_memberships(organization_id,user_id,role,can_invite_staff) VALUES($1,$2,'owner',true)",
          [org, owner],
        );
      }
      for (let index = 0; index < materials.length; index++) {
        const key = `demo-listing-${supplier + 1}-${index + 1}`;
        if (await existing(runner, key)) continue;
        const listing = await repo.createListing(
          runner,
          org,
          owner,
          listingInput.parse(fixtureListing(supplier, index)),
        );
        await runner.query(
          "UPDATE app.listings SET is_demo=true,status='published' WHERE id=$1",
          [listing.id],
        );
        await record(runner, key, "listing", listing.id);
        await repo.audit(
          runner,
          admin,
          org,
          listing.id,
          "listing.demo_seeded",
          "Synthetic opt-in fixture; not a real supplier or transaction",
        );
      }
    }
  });
  console.log(
    "Demo seed ready: 4 synthetic suppliers and 20 labelled listings. Existing marked records were preserved.",
  );
  console.log(
    "Accounts: demo-buyer, demo-admin, demo-owner-1 through demo-owner-4 @resourcepk.example.invalid",
  );
  console.log(
    "Use the DEMO_PASSWORD you supplied when these accounts were first created. No emails were sent.",
  );
}
seed()
  .catch((error) => {
    console.error(
      error.name === "ZodError"
        ? "Choose a strong DEMO_PASSWORD of 10–72 UTF-8 bytes."
        : error.message,
    );
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
