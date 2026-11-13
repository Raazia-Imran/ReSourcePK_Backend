const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalize,
  hashPassport,
} = require("../src/modules/passports/canonical");

// Load our three permanent test vectors.
const fixtureDirectory = path.join(__dirname, "fixtures", "passport");

const fixtures = ["vector1.json", "vector2.json", "vector3.json"].map(
  (filename) => {
    const filePath = path.join(fixtureDirectory, filename);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  },
);

// Test 1: Every fixture must produce its expected canonical JSON and hash.
test("all fixed passport test vectors produce their expected hashes", () => {
  for (const fixture of fixtures) {
    const canonical = canonicalize(fixture.input);
    const hash = hashPassport(canonical);

    assert.equal(canonical, fixture.expectedCanonical);
    assert.equal(hash, fixture.expectedHash);
  }
});

// Test 2: Changing object key order must not change the hash.
test("object key order does not affect the canonical hash", () => {
  const first = {
    colour: "White",
    quantity: "10.000",
    schemaVersion: 1,
    unit: "kg",
  };

  const second = {
    unit: "kg",
    schemaVersion: 1,
    colour: "White",
    quantity: "10.000",
  };

  assert.equal(
    hashPassport(canonicalize(first)),
    hashPassport(canonicalize(second)),
  );
});

// Test 3: Changing passport information must change the hash.
test("changing passport data produces a different hash", () => {
  const original = {
    colour: "White",
    quantity: "10.000",
    unit: "kg",
  };

  const modified = {
    colour: "Black",
    quantity: "10.000",
    unit: "kg",
  };

  assert.notEqual(
    hashPassport(canonicalize(original)),
    hashPassport(canonicalize(modified)),
  );
});

// Test 4: Invalid numbers and undefined values must be rejected.
test("canonicalize rejects floats, NaN, Infinity and undefined", () => {
  assert.throws(() => canonicalize({ quantity: 1.5 }), TypeError);
  assert.throws(() => canonicalize({ quantity: NaN }), TypeError);
  assert.throws(() => canonicalize({ quantity: Infinity }), TypeError);
  assert.throws(() => canonicalize({ quantity: undefined }), TypeError);
});

// Test 5: Arrays preserve their order.
test("array order is preserved during canonicalization", () => {
  const first = {
    composition: ["Cotton", "Polyester"],
  };

  const second = {
    composition: ["Polyester", "Cotton"],
  };

  assert.notEqual(
    hashPassport(canonicalize(first)),
    hashPassport(canonicalize(second)),
  );
});

// Test 6: Hash output must be 64 lowercase hexadecimal characters.
test("hashPassport returns a lowercase 64-character SHA-256 hash", () => {
  const hash = hashPassport('{"colour":"White"}');

  assert.match(hash, /^[a-f0-9]{64}$/);
});
