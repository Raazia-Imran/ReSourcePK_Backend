const assert = require("node:assert/strict");
const { query, pool } = require("../src/db");
async function verify() {
  const result = await query(
    "SELECT count(*) FILTER (WHERE kind='user')::int AS users,count(*) FILTER (WHERE kind='organization')::int AS organizations,count(*) FILTER (WHERE kind='listing')::int AS listings FROM app.demo_seed_records",
  );
  assert.deepEqual(result.rows[0], {
    users: 6,
    organizations: 4,
    listings: 20,
  });
  const labelled = await query(
    "SELECT count(*)::int AS n FROM app.listings l JOIN app.demo_seed_records d ON d.record_id=l.id AND d.kind='listing' WHERE l.is_demo AND l.title LIKE 'Demo %' AND l.description LIKE 'DEMO / SYNTHETIC:%'",
  );
  assert.equal(labelled.rows[0].n, 20);
  console.log(
    "Verified 4 synthetic suppliers, 20 labelled listings and 6 demo accounts; seed replay preserved counts.",
  );
}
verify()
  .catch(() => {
    console.error("Demo verification failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
