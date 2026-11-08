
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSnapshotForOrder,
} = require("../src/modules/passports/service");

test("creates a passport snapshot for a completed order", async () => {
  const queries = [];

  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      // Mock the completed order and its listing.
      if (sql.includes("JOIN app.listings")) {
        return {
          rowCount: 1,
          rows: [
            {
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
            },
          ],
        };
      }

      // Mock successful snapshot insertion.
      if (sql.includes("INSERT INTO app.passport_snapshots")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: params[0],
              order_id: params[1],
              version: 1,
              canonical_json: params[2],
              snapshot_data: params[3],
              passport_hash: params[4],
              status: "pending",
            },
          ],
        };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const snapshot = await createSnapshotForOrder(
    runner,
    "order-1",
  );

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
  assert.match(
    insertQueries[0].sql,
    /ON CONFLICT\s*\(order_id,\s*version\)\s*DO NOTHING/i,
  );
});


test("does not create duplicate snapshots when called again", async () => {
  const queries = [];
  let savedSnapshot = null;

  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("JOIN app.listings")) {
        return {
          rowCount: 1,
          rows: [
            {
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
            },
          ],
        };
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

      if (sql.includes("SELECT *") &&
          sql.includes("FROM app.passport_snapshots")) {
        return {
          rowCount: savedSnapshot ? 1 : 0,
          rows: savedSnapshot ? [savedSnapshot] : [],
        };
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
});