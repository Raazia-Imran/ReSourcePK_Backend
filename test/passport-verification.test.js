const test = require("node:test");
const assert = require("node:assert/strict");

const { hashPassport } = require("../src/modules/passports/canonical");
const {
  createVerificationService,
} = require("../src/modules/passports/verificationService");

const passportId = "11111111-1111-4111-8111-111111111111";
const canonicalJson = JSON.stringify({
  passportId,
  version: 1,
  completion: "completed",
});

function makeSnapshot(overrides = {}) {
  return {
    id: passportId,
    version: 1,
    canonical_json: canonicalJson,
    passport_hash: hashPassport(canonicalJson),
    snapshot_data: { passportId, version: 1 },
    status: "pending",
    network: "Polygon Amoy (testnet)",
    tx_hash: null,
    anchored_at: null,
    ...overrides,
  };
}

test("pending passport returns matches null", async () => {
  const snapshot = makeSnapshot();

  const service = createVerificationService({
    queryFn: async () => ({ rows: [snapshot] }),
    adapter: null,
  });

  const result = await service.getPublicVerification(passportId);

  assert.equal(result.status, "pending");
  assert.equal(result.matches, null);
});

test("anchored passport returns matches true when hashes match", async () => {
  const snapshot = makeSnapshot({
    status: "anchored",
    tx_hash: "0xtesttransaction",
    anchored_at: new Date("2026-11-10T10:00:00Z"),
  });

  const service = createVerificationService({
    queryFn: async () => ({ rows: [snapshot] }),
    adapter: {
      get: async () => `0x${snapshot.passport_hash}`,
    },
  });

  const result = await service.getPublicVerification(passportId);

  assert.equal(result.status, "anchored");
  assert.equal(result.matches, true);
  assert.equal(result.transactionId, "0xtesttransaction");
});

test("changed canonical JSON returns matches false", async () => {
  const snapshot = makeSnapshot({
    status: "anchored",
    canonical_json: JSON.stringify({
      passportId,
      version: 1,
      completion: "tampered",
    }),
  });

  const service = createVerificationService({
    queryFn: async () => ({ rows: [snapshot] }),
    adapter: {
      get: async () => `0x${snapshot.passport_hash}`,
    },
  });

  const result = await service.getPublicVerification(passportId);

  assert.equal(result.matches, false);
});

test("unknown passport returns 404", async () => {
  const service = createVerificationService({
    queryFn: async () => ({ rows: [] }),
    adapter: null,
  });

  await assert.rejects(
    service.getPublicVerification(passportId),
    (error) => error.status === 404,
  );
});

test("public response does not expose private snapshot fields", async () => {
  const snapshot = makeSnapshot({
    snapshot_data: {
      passportId,
      version: 1,
      buyerEmail: "private@example.com",
      sellerPhone: "03000000000",
      price: 5000,
      address: "Private address",
    },
  });

  const service = createVerificationService({
    queryFn: async () => ({ rows: [snapshot] }),
    adapter: null,
  });

  const result = await service.getPublicVerification(passportId);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("03000000000"), false);
  assert.equal(serialized.includes("Private address"), false);
  assert.equal(serialized.includes('"price"'), false);
  assert.equal(serialized.includes("buyerEmail"), false);
});