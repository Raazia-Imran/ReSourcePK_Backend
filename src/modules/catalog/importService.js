const crypto = require("node:crypto");
const { readSheet: readXlsxFile } = require("read-excel-file/node");
const { parse: parseCsv } = require("csv-parse/sync");
const db = require("../../db");
const service = require("./service");
const repo = require("./repository");
const { listingInput } = require("./validation");
const { AppError } = require("../../lib/errors");
const columns = [
  "title",
  "description",
  "material",
  "condition",
  "unit",
  "quantity",
  "minOrderQuantity",
  "pricePerUnit",
];
function validateImportRows(rows, numbers = []) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100)
    throw new AppError(
      422,
      "IMPORT_SIZE",
      "Import between 1 and 100 rows at a time",
    );
  const errors = [];
  const valid = [];
  rows.forEach((row, index) => {
    const result = listingInput.safeParse(row);
    if (!result.success)
      errors.push({
        row: numbers[index] || index + 2,
        fields: result.error.flatten().fieldErrors,
      });
    else valid.push(result.data);
  });
  return { valid, errors };
}

const { sanitizeZip: checkZipSize } = require("./zipGuard");

async function preview(file) {
  if (!file)
    throw new AppError(422, "FILE_REQUIRED", "Choose a CSV or XLSX file");
  const fileName = file.originalname.toLowerCase();
  if (!/\.(csv|xlsx)$/.test(fileName))
    throw new AppError(
      422,
      "FILE_TYPE",
      "Only CSV and XLSX files are supported",
    );
  const workbook = fileName.endsWith(".xlsx")
    ? checkZipSize(file.buffer)
    : null;
  let table;
  try {
    if (fileName.endsWith(".csv"))
      table = parseCsv(file.buffer, {
        bom: true,
        skip_empty_lines: false,
        max_record_size: 10000,
      });
    else table = await readXlsxFile(workbook);
  } catch {
    throw new AppError(
      422,
      "INVALID_FILE",
      "Could not read this CSV or XLSX file",
    );
  }
  if (!table?.length || table.length > 101)
    throw new AppError(
      422,
      "IMPORT_SIZE",
      "File must have a header and at most 100 data rows",
    );
  const headers = table[0].map((value) => String(value || "").trim());
  if (
    headers.some((value, i) => value !== columns[i]) ||
    headers.length !== columns.length
  )
    throw new AppError(
      422,
      "IMPORT_HEADERS",
      "Headers must exactly match the downloadable template",
    );
  const rows = [];
  const rowNumbers = [];
  for (let number = 2; number <= table.length; number++) {
    const cells = table[number - 1];
    if (cells.every((cell) => cell === null || cell === "")) continue;
    if (cells.length > columns.length)
      throw new AppError(
        422,
        "IMPORT_COLUMNS",
        `Row ${number} has extra columns`,
      );
    const row = Object.fromEntries(
      columns.map((name, index) => [name, cells[index]]),
    );
    rows.push(row);
    rowNumbers.push(number);
  }
  const { valid, errors } = validateImportRows(rows, rowNumbers);
  return {
    rows: valid,
    errors,
    validCount: valid.length,
    invalidCount: errors.length,
  };
}
async function commit(user, org, input) {
  const { valid, errors } = validateImportRows(input.rows);
  if (errors.length)
    throw new AppError(
      422,
      "IMPORT_ROWS_INVALID",
      "Correct all rows before importing",
      errors,
    );
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(valid))
    .digest("hex");
  return db.transaction(async (runner) => {
    await service.requireSeller(user, org, runner);
    const inserted = await repo.insertImportBatch(
      runner,
      org,
      user,
      input.requestKey,
      payloadHash,
      valid.length,
    );
    if (!inserted) {
      const old = await repo.importBatch(runner, org, input.requestKey);
      if (old.payload_hash !== payloadHash)
        throw new AppError(
          409,
          "IMPORT_KEY_REUSED",
          "This import key was used with different rows",
        );
      return { created: old.listing_count, duplicate: true };
    }
    for (const row of valid) {
      const listing = await repo.createListing(runner, org, user, row);
      await repo.audit(runner, user, org, listing.id, "listing.imported");
    }
    return { created: valid.length, duplicate: false };
  });
}
module.exports = { columns, preview, commit, validateImportRows, checkZipSize };
