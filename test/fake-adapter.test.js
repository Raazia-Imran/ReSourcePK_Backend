const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FakeAdapter,
  ZERO_HASH,
} = require("../src/modules/blockchain/fakeAdapter");

const KEY = `0x${"1".repeat(64)}`;
const HASH = `0x${"a".repeat(64)}`;
const ANOTHER_HASH = `0x${"b".repeat(64)}`;

test("returns the zero hash when a key has not been anchored", async () => {
  const adapter = new FakeAdapter();

  const result = await adapter.get(KEY);

  assert.equal(result, ZERO_HASH);
});

test("successfully anchors a hash", async () => {
  const adapter = new FakeAdapter();

  const txHash = await adapter.anchor(KEY, HASH);

  assert.match(txHash, /^0x[0-9a-f]{64}$/);
});

test("returns the stored hash after anchoring", async () => {
  const adapter = new FakeAdapter();

  await adapter.anchor(KEY, HASH);

  const result = await adapter.get(KEY);

  assert.equal(result, HASH);
});

test("rejects a second anchor for an existing key", async () => {
  const adapter = new FakeAdapter();

  await adapter.anchor(KEY, HASH);

  await assert.rejects(() => adapter.anchor(KEY, ANOTHER_HASH), {
    message: "already anchored",
  });
});

test("rejects an invalid key", async () => {
  const adapter = new FakeAdapter();

  await assert.rejects(() => adapter.get("invalid-key"), {
    name: "TypeError",
    message: "key must be a valid bytes32 hexadecimal value",
  });
});

test("rejects an invalid hash", async () => {
  const adapter = new FakeAdapter();

  await assert.rejects(() => adapter.anchor(KEY, "invalid-hash"), {
    name: "TypeError",
    message: "hash must be a valid bytes32 hexadecimal value",
  });
});

test("treats uppercase and lowercase keys as the same key", async () => {
  const adapter = new FakeAdapter();

  await adapter.anchor(KEY, HASH);

  const result = await adapter.get(KEY.toUpperCase().replace("0X", "0x"));

  assert.equal(result, HASH);
});
