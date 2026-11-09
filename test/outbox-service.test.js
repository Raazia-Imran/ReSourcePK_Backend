
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enqueuePassportAnchor,
} = require("../src/modules/blockchain/outboxService");

test("successfully creates a blockchain anchor and outbox job", async () => {
  const queries = [];

  const tx = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("INSERT INTO app.blockchain_anchors")) {
        return {
          rowCount: 1,
          rows: [{ id: "anchor-1" }],
        };
      }

      if (sql.includes("INSERT INTO app.outbox")) {
        return {
          rowCount: 1,
          rows: [{ id: "outbox-1" }],
        };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const snapshot = {
    id: "snapshot-1",
    passport_hash: "abc123hash",
  };

  const result = await enqueuePassportAnchor(tx, snapshot);

  assert.equal(result.enqueued, true);
  assert.equal(result.anchorId, "anchor-1");

  // Both database inserts should have happened.
  assert.equal(queries.length, 2);

  // Verify the anchor insert.
  assert.match(
    queries[0].sql,
    /INSERT INTO app\.blockchain_anchors/i,
  );

  assert.equal(queries[0].params[0], "snapshot-1");

  // Verify the outbox job.
  assert.match(
    queries[1].sql,
    /INSERT INTO app\.outbox/i,
  );

  assert.equal(queries[1].params[0], "passport.anchor");

  assert.deepEqual(queries[1].params[1], {
    passportSnapshotId: "snapshot-1",
    passportHash: "abc123hash",
  });
});

test("does not create a duplicate outbox job when anchor already exists", async () => {
  const queries = [];

  const tx = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("INSERT INTO app.blockchain_anchors")) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const result = await enqueuePassportAnchor(tx, {
    id: "snapshot-1",
    passport_hash: "abc123hash",
  });

  assert.deepEqual(result, {
    enqueued: false,
    reason: "anchor_already_exists",
  });

  // Only the anchor insert should have happened.
  assert.equal(queries.length, 1);
});

test("propagates database errors", async () => {
  const tx = {
    query: async () => {
      throw new Error("Database connection failed");
    },
  };

  await assert.rejects(
    () =>
      enqueuePassportAnchor(tx, {
        id: "snapshot-1",
        passport_hash: "abc123hash",
      }),
    {
      message: "Database connection failed",
    },
  );
});

test("rejects an invalid transaction client", async () => {
  await assert.rejects(
    () => enqueuePassportAnchor(null, {
      id: "snapshot-1",
      passport_hash: "abc123hash",
    }),
    {
      name: "TypeError",
      message: "A valid transaction client is required",
    },
  );
});

test("rejects an invalid passport snapshot", async () => {
  const tx = {
    query: async () => ({ rowCount: 0, rows: [] }),
  };

  await assert.rejects(
    () => enqueuePassportAnchor(tx, null),
    {
      name: "TypeError",
      message: "A valid passport snapshot is required",
    },
  );
});
