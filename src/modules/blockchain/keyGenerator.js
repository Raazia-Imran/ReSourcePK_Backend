// const test = require("node:test");
// const assert = require("node:assert/strict");
// const { createHash } = require("node:crypto");

// const {
//   generatePassportKey,
// } = require("../src/modules/blockchain/keyGenerator");

// test("generates a valid bytes32 key", () => {
//   const key = generatePassportKey(
//     "550e8400-e29b-41d4-a716-446655440000",
//     1,
//   );

//   assert.match(key, /^0x[0-9a-fA-F]{64}$/);
// });

// test("generates the same key for identical passport data", () => {
//   const passportId = "passport-123";

//   const firstKey = generatePassportKey(passportId, 1);
//   const secondKey = generatePassportKey(passportId, 1);

//   assert.equal(firstKey, secondKey);
// });

// test("generates different keys for different versions", () => {
//   const passportId = "passport-123";

//   const versionOne = generatePassportKey(passportId, 1);
//   const versionTwo = generatePassportKey(passportId, 2);

//   assert.notEqual(versionOne, versionTwo);
// });

// test("matches SHA-256 of passportId:version", () => {
//   const expected =
//     "0xdb6eb344e3fc26f5c0664285be9a451a410468c8e518a4a15ad66d6302885ebe";

//   assert.equal(generatePassportKey("passport-123", 1), expected);
// });

// test("rejects an empty passport ID", () => {
//   assert.throws(
//     () => generatePassportKey("", 1),
//     /valid passportId/,
//   );
// });

// test("rejects an invalid version", () => {
//   assert.throws(
//     () => generatePassportKey("passport-123", 0),
//     /valid passport version/,
//   );
// });

// test("rejects a non-integer version", () => {
//   assert.throws(
//     () => generatePassportKey("passport-123", 1.5),
//     /valid passport version/,
//   );
// });

const { createHash } = require("node:crypto");

/**
 * Generates a deterministic blockchain key for a passport snapshot.
 *
 * The key is SHA-256 of:
 * passportId:version
 *
 * Returns a bytes32 hexadecimal value.
 */
function generatePassportKey(passportId, version) {
  if (typeof passportId !== "string" || !passportId.trim()) {
    throw new TypeError("A valid passportId is required");
  }

  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("A valid passport version is required");
  }

  const keyInput = `${passportId}:${version}`;

  return `0x${createHash("sha256").update(keyInput, "utf8").digest("hex")}`;
}

module.exports = {
  generatePassportKey,
};
