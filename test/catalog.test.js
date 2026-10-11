const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_ACCESS_SECRET =
  "test-secret-with-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";
const {
  listingInput,
  money,
  quantity,
  scaled,
} = require("../src/modules/catalog/validation");
const valid = {
  title: "Cotton offcuts",
  description: "Sorted unused clean cotton offcuts for reuse.",
  material: "Cotton",
  condition: "Clean",
  unit: "kg",
  quantity: "100.125",
  minOrderQuantity: "10.001",
  pricePerUnit: "210.29",
};
test("decimal money uses exact paisa and rejects rounding, exponent, empty and whitespace input", () => {
  assert.equal(scaled(money.parse("210.29"), 2), 21029n);
  assert.equal(scaled(quantity.parse("100.125"), 3), 100125n);
  for (const input of [
    "",
    " ",
    "1e2",
    "1.001",
    "NaN",
    "-1",
    "0",
    "100000000.01",
    "01.00",
  ])
    assert.equal(money.safeParse(input).success, false, input);
  assert.equal(money.safeParse("100000000.00").success, true);
  assert.equal(quantity.safeParse("0.001").success, true);
});
test("invalid decimals return validation issues instead of throwing a conversion error", () => {
  for (const key of ["quantity", "minOrderQuantity", "pricePerUnit"]) {
    for (const value of ["bad", "", "1e10", "1.0001"])
      assert.equal(
        listingInput.safeParse({ ...valid, [key]: value }).success,
        false,
      );
  }
});
test("price tiers stay within stock, increase from MOQ and never increase price", () => {
  const good = [
    { minQuantity: "10.001", pricePerUnit: "200.00" },
    { minQuantity: "90", pricePerUnit: "190.00" },
  ];
  assert.equal(
    listingInput.safeParse({ ...valid, priceTiers: good }).success,
    true,
  );
  for (const tiers of [
    [good[1], good[0]],
    [good[0], good[0]],
    [{ minQuantity: "5", pricePerUnit: "200" }],
    [{ minQuantity: "101", pricePerUnit: "200" }],
    [{ minQuantity: "50", pricePerUnit: "211" }],
  ])
    assert.equal(
      listingInput.safeParse({ ...valid, priceTiers: tiers }).success,
      false,
    );
  assert.equal(
    listingInput.safeParse({ ...valid, is_demo: true }).success,
    false,
  );
  assert.equal(
    listingInput.safeParse({ ...valid, minOrderQuantity: "101" }).success,
    false,
  );
});
test("raster re-encoding removes metadata and limits output dimensions", async () => {
  const sharp = require("sharp");
  const { normalizeImage } = require("../src/modules/catalog/imageAdapter");
  const input = await sharp({
    create: { width: 1700, height: 100, channels: 3, background: "#446644" },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const output = await normalizeImage(input);
  const meta = await sharp(output.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1600);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
});
test("active formats, forged headers, corrupt raster and oversized images are rejected", async () => {
  const { normalizeImage } = require("../src/modules/catalog/imageAdapter");
  for (const input of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from([255, 216, 255]),
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ])
    await assert.rejects(
      () => normalizeImage(input),
      (error) => error.status === 422,
    );
  const sharp = require("sharp");
  const oversizedPixels = await sharp({
    create: { width: 4001, height: 4001, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    () => normalizeImage(oversizedPixels),
    (error) => error.status === 422,
  );
});
test("only Owner and Manager may mutate seller stock", async (t) => {
  const repo = require("../src/modules/catalog/repository");
  const service = require("../src/modules/catalog/service");
  for (const role of ["staff", "org_admin", undefined]) {
    const mock = t.mock.method(repo, "sellerRole", async () => role);
    await assert.rejects(
      () => service.requireSeller("user", "org"),
      (error) => error.status === 403,
    );
    mock.mock.restore();
  }
  for (const role of ["owner", "manager"]) {
    const mock = t.mock.method(repo, "sellerRole", async () => role);
    await service.requireSeller("user", "org");
    mock.mock.restore();
  }
});
test("stale edits and edits to published or archived stock are denied", () => {
  const { editable } = require("../src/modules/catalog/service");
  for (const status of ["published", "pending_review", "archived"])
    assert.throws(
      () => editable({ status, version: 1 }, 1),
      (error) => error.status === 409,
    );
  assert.throws(
    () => editable({ status: "draft", version: 2 }, 1),
    (error) => error.code === "VERSION_CONFLICT",
  );
  editable({ status: "rejected", version: 2 }, 2);
});
test("another buyer cannot change a requirement, and closed requirements cannot reopen", async (t) => {
  const db = require("../src/db");
  const repo = require("../src/modules/catalog/repository");
  const service = require("../src/modules/catalog/service");
  t.mock.method(db, "transaction", async (work) =>
    work({ query: async () => ({ rows: [] }) }),
  );
  const lock = t.mock.method(repo, "lockRequirement", async () => undefined);
  await assert.rejects(
    () => service.requirementStatus("other", "id", "paused", 1),
    (error) => error.status === 404,
  );
  lock.mock.restore();
  t.mock.method(repo, "lockRequirement", async () => ({
    status: "closed",
    version: 1,
  }));
  await assert.rejects(
    () => service.requirementStatus("owner", "id", "active", 1),
    (error) => error.status === 409,
  );
});
test("import validation bounds rows and reports invalid physical spreadsheet rows", () => {
  const {
    validateImportRows,
  } = require("../src/modules/catalog/importService");
  assert.throws(
    () => validateImportRows(Array(101).fill(valid)),
    (error) => error.code === "IMPORT_SIZE",
  );
  const result = validateImportRows(
    [valid, { ...valid, pricePerUnit: "bad" }],
    [2, 9],
  );
  assert.equal(result.valid.length, 1);
  assert.equal(result.errors[0].row, 9);
});
test("demo fixtures contain exactly four synthetic suppliers and twenty valid listings", () => {
  const {
    suppliers,
    materials,
    fixtureListing,
  } = require("../scripts/demo-fixtures");
  assert.equal(suppliers.length, 4);
  assert.equal(materials.length, 5);
  for (let supplier = 0; supplier < 4; supplier++)
    for (let i = 0; i < 5; i++) {
      const input = listingInput.parse(fixtureListing(supplier, i));
      assert.match(input.description, /DEMO \/ SYNTHETIC/);
    }
});
test.after(() => require("../src/db").pool.end());
test("real XLSX and CSV templates parse through the bounded preview flow", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const { preview, columns } = require("../src/modules/catalog/importService");
  const workbook = await preview({
    originalname: "factory.xlsx",
    buffer: await fs.readFile(
      path.join(__dirname, "fixtures/catalog-valid.xlsx"),
    ),
  });
  assert.equal(workbook.validCount, 1);
  assert.equal(workbook.invalidCount, 0);
  assert.equal(workbook.rows[0].pricePerUnit, "210.29");
  const csv = await preview({
    originalname: "factory.csv",
    buffer: Buffer.from(
      columns.join(",") +
        "\nCotton stock,Unused sorted cotton stock for reuse.,Cotton,Clean,kg,100,10,210.29",
    ),
  });
  assert.equal(csv.validCount, 1);
  assert.equal(csv.rows[0].pricePerUnit, "210.29");
});
test("XLSX guard validates actual entries, rejects forged sizes and returns a sanitized archive", () => {
  const {
    sanitizeZip,
    storedArchive,
  } = require("../src/modules/catalog/zipGuard");
  const file = storedArchive([
    {
      nameBytes: Buffer.from("xl/workbook.xml"),
      data: Buffer.from("<workbook/>"),
    },
  ]);
  assert.deepEqual(sanitizeZip(file), file);
  const forged = Buffer.from(file);
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(1, central + 24);
  assert.throws(
    () => sanitizeZip(forged),
    (error) => error.status === 422,
  );
  assert.throws(
    () => sanitizeZip(Buffer.from("invalid")),
    (error) => error.status === 422,
  );
  const large = storedArchive([
    {
      nameBytes: Buffer.from("xl/workbook.xml"),
      data: Buffer.alloc(8 * 1024 * 1024 + 1),
    },
  ]);
  assert.throws(
    () => sanitizeZip(large),
    (error) => error.status === 422,
  );
});
