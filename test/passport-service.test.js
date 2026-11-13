const test = require("node:test");
const assert = require("node:assert/strict");

function oneRow(row) {
  return { rowCount: 1, rows: [row] };
}

const { createSnapshotForOrder } = require("../src/modules/passports/service");

test("creates a passport snapshot for a completed order", async () => {
  const queries = [];

  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      // Mock the completed order and its listing.
      if (sql.includes("JOIN app.listings")) {
        return oneRow({
          id: "order-1",
          listing_id: "listing-1",
          quantity: "12.500",
          unit: "kg",
          completed_at: "2026-11-08T10:00:00.000Z",
          fulfilment_status: "completed",
          material: "Cotton",
          composition: "100% Cotton",
          color: "White",
          condition: "Good",
        });
      }

      // Mock successful snapshot insertion.
      if (sql.includes("INSERT INTO app.passport_snapshots")) {
        return oneRow({
          id: params[0],
          order_id: params[1],
          version: 1,
          canonical_json: params[2],
          snapshot_data: params[3],
          passport_hash: params[4],
          status: "pending",
        });
      }

      // Mock successful blockchain anchor insertion.
      if (sql.includes("INSERT INTO app.blockchain_anchors")) {
        return oneRow({ id: "anchor-1" });
      }

      // Mock successful outbox job insertion.
      if (sql.includes("INSERT INTO app.outbox")) {
        return oneRow({ id: "outbox-1" });
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const snapshot = await createSnapshotForOrder(runner, "order-1");

  // Verify the returned snapshot.
  assert.equal(snapshot.order_id, "order-1");
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.status, "pending");

  // Verify the passport contains the expected information.
  assert.equal(snapshot.snapshot_data.orderId, "order-1");
  assert.equal(snapshot.snapshot_data.materialCategory, "Cotton");
  assert.equal(snapshot.snapshot_data.quantity, "12.500");

  // Verify that the snapshot was inserted exactly once.
  const insertQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.passport_snapshots"),
  );

  assert.equal(insertQueries.length, 1);

  // Verify first-version duplicate protection exists.
  //   assert.match(
  //     insertQueries[0].sql,
  //     /ON CONFLICT\s*\(order_id,\s*version\)\s*DO NOTHING/i,
  //   );
  // });

  // Verify first-version duplicate protection exists.
  assert.match(
    insertQueries[0].sql,
    /ON CONFLICT\s*\(order_id,\s*version\)\s*DO NOTHING/i,
  );

  // Verify that one blockchain anchor was created.
  const anchorQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.blockchain_anchors"),
  );

  assert.equal(anchorQueries.length, 1);

  // Verify that one outbox job was created.
  const outboxQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.outbox"),
  );

  assert.equal(outboxQueries.length, 1);
  assert.equal(outboxQueries[0].params[0], "passport.anchor");
  assert.deepEqual(outboxQueries[0].params[1], {
    passportSnapshotId: snapshot.id,
    passportHash: snapshot.passport_hash,
  });
});

test("does not create duplicate snapshots when called again", async () => {
  const queries = [];
  let savedSnapshot = null;

  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("JOIN app.listings")) {
        return oneRow({
          id: "order-1",
          listing_id: "listing-1",
          quantity: "12.500",
          unit: "kg",
          completed_at: "2026-11-08T10:00:00.000Z",
          fulfilment_status: "completed",
          material: "Cotton",
          composition: "100% Cotton",
          color: "White",
          condition: "Good",
        });
      }

      if (sql.includes("INSERT INTO app.passport_snapshots")) {
        if (savedSnapshot) {
          return { rowCount: 0, rows: [] };
        }

        savedSnapshot = {
          id: params[0],
          order_id: params[1],
          version: 1,
          canonical_json: params[2],
          snapshot_data: params[3],
          passport_hash: params[4],
          status: "pending",
        };

        return {
          rowCount: 1,
          rows: [savedSnapshot],
        };
      }

      if (
        sql.includes("FROM app.passport_snapshots") &&
        sql.includes("WHERE order_id = $1")
      ) {
        return {
          rowCount: savedSnapshot ? 1 : 0,
          rows: savedSnapshot ? [savedSnapshot] : [],
        };
      }

      // Mock successful blockchain anchor insertion.
      if (sql.includes("INSERT INTO app.blockchain_anchors")) {
        return oneRow({ id: "anchor-1" });
      }

      // Mock successful outbox job insertion.
      if (sql.includes("INSERT INTO app.outbox")) {
        return oneRow({ id: "outbox-1" });
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const firstSnapshot = await createSnapshotForOrder(runner, "order-1");
  const secondSnapshot = await createSnapshotForOrder(runner, "order-1");

  assert.equal(firstSnapshot.id, secondSnapshot.id);
  assert.equal(firstSnapshot.order_id, secondSnapshot.order_id);

  const insertQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.passport_snapshots"),
  );

  assert.equal(insertQueries.length, 2);
  assert.equal(savedSnapshot.order_id, "order-1");

  // Only the first call should create a blockchain anchor.
  const anchorQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.blockchain_anchors"),
  );

  assert.equal(anchorQueries.length, 1);

  // Only the first call should create an outbox job.
  const outboxQueries = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.outbox"),
  );

  assert.equal(outboxQueries.length, 1);
});
