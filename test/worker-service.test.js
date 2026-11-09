
const test = require("node:test");
const assert = require("node:assert/strict");

const { FakeAdapter } = require("../src/modules/blockchain/fakeAdapter");
const { generatePassportKey } = require("../src/modules/blockchain/keyGenerator");

const {
  createWorkerService,
} = require("../src/modules/blockchain/workerService");

test("claims and returns an available blockchain job", async () => {
  const job = {
    id: "job-1",
    type: "passport.anchor",
    status: "processing",
    attempts: 0,
    payload: {
      passportSnapshotId: "snapshot-1",
      passportHash: "abc123hash",
    },
  };

  let transactionCalled = false;

  const mockTransaction = async (callback) => {
    transactionCalled = true;

    return callback({
        query: async (sql) => {
            // First query handles expired jobs; no exhausted jobs in this test.
            if (/WITH exhausted AS/i.test(sql)) {
                return {
                    rows: [],
                    rowCount: 0,
                };
            }

            // Second query claims the available job.
            assert.match(sql, /FOR UPDATE SKIP LOCKED/i);
            assert.match(sql, /UPDATE app\.outbox/i);
            return {
                rows: [job],
                rowCount: 1,
            };
        },
    });
};

  const workerService = createWorkerService(mockTransaction);

  const result = await workerService.claimNextJob();

  assert.deepEqual(result, job);
  assert.equal(transactionCalled, true);
});

test("returns null when no blockchain job is available", async () => {
  const mockTransaction = async (callback) => {
    return callback({
      query: async () => ({
        rows: [],
        rowCount: 0,
      }),
    });
  };

  const workerService = createWorkerService(mockTransaction);

  const result = await workerService.claimNextJob();

  assert.equal(result, null);
});

test("claims a job inside a database transaction", async () => {
  let transactionCalled = false;
  let queryCalled = false;

  const mockTransaction = async (callback) => {
    transactionCalled = true;

    return callback({
      query: async () => {
        queryCalled = true;

        return {
          rows: [],
          rowCount: 0,
        };
      },
    });
  };

  const workerService = createWorkerService(mockTransaction);

  await workerService.claimNextJob();

  assert.equal(transactionCalled, true);
  assert.equal(queryCalled, true);
});


test("successfully processes a passport anchor job", async () => {
  const passportHash = "a".repeat(64);

  const job = {
    id: "job-success",
    type: "passport.anchor",
    attempts: 1,
    payload: {
      passportSnapshotId: "snapshot-success",
      passportHash,
    },
  };

  const snapshot = {
    id: "snapshot-success",
    version: 1,
    passport_hash: passportHash,
    snapshot_data: {
      passportId: "passport-success",
      version: 1,
    },
  };

  let anchorUpdated = false;
  let outboxUpdated = false;

  const mockTransaction = async (callback) => {
    return callback({
      query: async (sql) => {
        if (/WITH exhausted AS/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        if (/WITH candidate AS/i.test(sql)) {
          return { rows: [job], rowCount: 1 };
        }

        if (/FROM app\.passport_snapshots/i.test(sql)) {
          return { rows: [snapshot], rowCount: 1 };
        }

        if (/UPDATE app\.blockchain_anchors/i.test(sql)) {
          anchorUpdated = true;
          return { rows: [], rowCount: 1 };
        }

        if (/UPDATE app\.outbox/i.test(sql)) {
          outboxUpdated = true;
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected SQL query: ${sql}`);
      },
    });
  };

  const adapter = new FakeAdapter();
  const workerService = createWorkerService(
    mockTransaction,
    adapter,
  );

  const result = await workerService.processNextJob();

  const key = generatePassportKey("passport-success", 1);
  const storedHash = await adapter.get(key);

  assert.equal(result.status, "completed");
  assert.equal(result.jobId, "job-success");
  assert.match(result.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(storedHash, `0x${passportHash}`);
  assert.equal(anchorUpdated, true);
  assert.equal(outboxUpdated, true);
});


function createRetryMockTransaction(jobs, snapshot) {
  return async (callback) =>
    callback({
      query: async (sql) => {
        if (/WITH exhausted AS/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        if (/WITH candidate AS/i.test(sql)) {
          const job = jobs.shift();
          return {
            rows: job ? [job] : [],
            rowCount: job ? 1 : 0,
          };
        }

        if (/FROM app\.passport_snapshots/i.test(sql)) {
          return { rows: [snapshot], rowCount: 1 };
        }

        if (/UPDATE app\.blockchain_anchors/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }

        if (/UPDATE app\.outbox/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected SQL query: ${sql}`);
      },
    });
}

test("retries twice and successfully anchors on the third attempt", async () => {
  const passportHash = "a".repeat(64);

  const snapshot = {
    id: "snapshot-retry",
    version: 1,
    passport_hash: passportHash,
    snapshot_data: {
      passportId: "passport-retry",
      version: 1,
    },
  };

  const jobs = [1, 2, 3].map((attempt) => ({
    id: "job-retry",
    type: "passport.anchor",
    attempts: attempt,
    payload: {
      passportSnapshotId: "snapshot-retry",
      passportHash,
    },
  }));

  const adapter = new FakeAdapter({
    failuresBeforeSuccess: 2,
  });

  const transaction = createRetryMockTransaction(jobs, snapshot);
  const worker = createWorkerService(transaction, adapter);

  const first = await worker.processNextJob();
  const second = await worker.processNextJob();
  const third = await worker.processNextJob();

  assert.equal(first.status, "retrying");
  assert.equal(second.status, "retrying");
  assert.equal(third.status, "completed");
  assert.match(third.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(adapter.failureCount, 3);
});

test("permanently fails after five unsuccessful attempts", async () => {
  const passportHash = "b".repeat(64);

  const snapshot = {
    id: "snapshot-failure",
    version: 1,
    passport_hash: passportHash,
    snapshot_data: {
      passportId: "passport-failure",
      version: 1,
    },
  };

  const jobs = [1, 2, 3, 4, 5].map((attempt) => ({
    id: "job-failure",
    type: "passport.anchor",
    attempts: attempt,
    payload: {
      passportSnapshotId: "snapshot-failure",
      passportHash,
    },
  }));

  const adapter = new FakeAdapter({
    alwaysFail: true,
  });

  const transaction = createRetryMockTransaction(jobs, snapshot);
  const worker = createWorkerService(transaction, adapter);

  const results = [];

  for (let i = 0; i < 5; i += 1) {
    results.push(await worker.processNextJob());
  }

  assert.deepEqual(
    results.map((result) => result.status),
    ["retrying", "retrying", "retrying", "retrying", "failed"],
  );

  assert.equal(adapter.failureCount, 5);
});

// Verifies that an expired processing job can be reclaimed after a worker crash.
test("reclaims a job whose worker lease has expired", async () => {
  const expiredJob = {
    id: "job-expired",
    type: "passport.anchor",
    status: "processing",
    attempts: 3,
    payload: {
      passportSnapshotId: "snapshot-expired",
      passportHash: "a".repeat(64),
    },
  };

  const mockTransaction = async (callback) =>
    callback({
      query: async (sql) => {
        if (/WITH exhausted AS/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        assert.match(sql, /status\s*=\s*'processing'/i);
        assert.match(sql, /locked_until\s*<=\s*now\(\)/i);
        assert.match(sql, /FOR UPDATE SKIP LOCKED/i);

        return { rows: [expiredJob], rowCount: 1 };
      },
    });

  const worker = createWorkerService(mockTransaction);
  const result = await worker.claimNextJob();

  assert.equal(result.id, "job-expired");
  assert.equal(result.status, "processing");
});

// Simulates two workers claiming different pending jobs concurrently.
test("two workers claim different jobs without claiming the same job", async () => {
  const jobs = [
    { id: "job-concurrent-1", status: "pending", attempts: 0 },
    { id: "job-concurrent-2", status: "pending", attempts: 0 },
  ];

  const mockTransaction = async (callback) =>
    callback({
      query: async (sql) => {
        if (/WITH exhausted AS/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        assert.match(sql, /FOR UPDATE SKIP LOCKED/i);

        const job = jobs.find((item) => item.status === "pending");

        if (!job) {
          return { rows: [], rowCount: 0 };
        }

        job.status = "processing";
        job.attempts += 1;

        return {
          rows: [{ ...job }],
          rowCount: 1,
        };
      },
    });

  const workerOne = createWorkerService(mockTransaction);
  const workerTwo = createWorkerService(mockTransaction);

  const [resultOne, resultTwo] = await Promise.all([
    workerOne.claimNextJob(),
    workerTwo.claimNextJob(),
  ]);

  assert.ok(resultOne);
  assert.ok(resultTwo);
  assert.notEqual(resultOne.id, resultTwo.id);
  assert.deepEqual(
    [resultOne.id, resultTwo.id].sort(),
    ["job-concurrent-1", "job-concurrent-2"],
  );
});
