const test = require("node:test");
const assert = require("node:assert/strict");
//const { ethers } = require("ethers");

const {
  generatePassportKey,
} = require("../src/modules/blockchain/keyGenerator");

test("generates a valid bytes32 key", () => {
  const key = generatePassportKey(
    "550e8400-e29b-41d4-a716-446655440000",
    1,
  );

  assert.match(key, /^0x[0-9a-fA-F]{64}$/);
});

test("generates the same key for identical passport data", () => {
  const passportId = "passport-123";

  const firstKey = generatePassportKey(passportId, 1);
  const secondKey = generatePassportKey(passportId, 1);

  assert.equal(firstKey, secondKey);
});

test("generates different keys for different versions", () => {
  const passportId = "passport-123";

  const versionOne = generatePassportKey(passportId, 1);
  const versionTwo = generatePassportKey(passportId, 2);

  assert.notEqual(versionOne, versionTwo);
});

// test("matches ethers.id key derivation", () => {
//   const passportId = "passport-123";
//   const version = 1;

//   const expected = ethers.id(`${passportId}:version-${version}`);

//   assert.equal(generatePassportKey(passportId, version), expected);
// });

test("matches SHA-256 of passportId:version", () => {
  const expected =
    "0xdb6eb344e3fc26f5c0664285be9a451a410468c8e518a4a15ad66d6302885ebe";

  assert.equal(generatePassportKey("passport-123", 1), expected);
});

test("rejects an empty passport ID", () => {
  assert.throws(
    () => generatePassportKey("", 1),
    /valid passportId/,
  );
});

test("rejects an invalid version", () => {
  assert.throws(
    () => generatePassportKey("passport-123", 0),
    /valid passport version/,
  );
});

test("rejects a non-integer version", () => {
  assert.throws(
    () => generatePassportKey("passport-123", 1.5),
    /valid passport version/,
  );
});