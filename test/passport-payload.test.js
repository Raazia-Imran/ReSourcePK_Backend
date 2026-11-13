const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPassportPayload,
} = require("../src/modules/passports/passportPayload");

const sampleData = {
  passportId: "550e8400-e29b-41d4-a716-446655440000",
  version: 1,
  order: {
    id: "order-1",
    listing_id: "listing-1",
    quantity: "10.000",
    unit: "kg",
    completed_at: "2026-11-07T21:30:00Z",
  },
  listing: {
    material: "Cotton",
    composition: "100% Cotton",
    color: "White",
    condition: "Clean",
  },
};

test("builds a passport payload with the correct fields", () => {
  const payload = buildPassportPayload(sampleData);

  assert.deepEqual(payload, {
    schemaVersion: 1,
    passportId: sampleData.passportId,
    version: 1,
    orderId: "order-1",
    listingId: "listing-1",
    materialCategory: "Cotton",
    composition: "100% Cotton",
    colour: "White",
    condition: "Clean",
    quantity: "10.000",
    unit: "kg",
    completedAt: "2026-11-07T21:30:00.000Z",
  });
});

test("does not include private or commercial information", () => {
  const payload = buildPassportPayload(sampleData);
  const keys = Object.keys(payload);

  assert.equal(keys.includes("price"), false);
  assert.equal(keys.includes("price_per_unit"), false);
  assert.equal(keys.includes("email"), false);
  assert.equal(keys.includes("phone"), false);
  assert.equal(keys.includes("address"), false);
  assert.equal(keys.includes("buyer_id"), false);
  assert.equal(keys.includes("seller_id"), false);
});

test("rejects a missing passport ID", () => {
  assert.throws(
    () =>
      buildPassportPayload({
        ...sampleData,
        passportId: "",
      }),
    TypeError,
  );
});

test("rejects an invalid passport version", () => {
  assert.throws(
    () =>
      buildPassportPayload({
        ...sampleData,
        version: 0,
      }),
    TypeError,
  );
});

test("rejects an incomplete order", () => {
  assert.throws(
    () =>
      buildPassportPayload({
        ...sampleData,
        order: {
          ...sampleData.order,
          completed_at: null,
        },
      }),
    /incomplete order/,
  );
});

test("rejects a quantity without exactly three decimal places", () => {
  assert.throws(
    () =>
      buildPassportPayload({
        ...sampleData,
        order: {
          ...sampleData.order,
          quantity: "10.5",
        },
      }),
    TypeError,
  );
});

test("rejects an invalid completion timestamp", () => {
  assert.throws(
    () =>
      buildPassportPayload({
        ...sampleData,
        order: {
          ...sampleData.order,
          completed_at: "not-a-date",
        },
      }),
    TypeError,
  );
});
