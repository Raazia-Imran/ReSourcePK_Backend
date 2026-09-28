const express = require("express");
const crypto = require("node:crypto");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const readXlsxFile = require("read-excel-file/node");
const { parse: parseCsv } = require("csv-parse/sync");
const { z } = require("zod");
const { query, transaction } = require("../db");
const { requireAuth } = require("../middlewares/authMiddleware");
const { AppError } = require("../lib/errors");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});
const importLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.auth.sub,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
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
const uuid = z.string().uuid();
const money = z.coerce
  .number()
  .finite()
  .positive()
  .max(100_000_000)
  .refine(
    (value) => Math.abs(value - Math.round(value * 100) / 100) < 1e-8,
    "Use at most two decimal places",
  );
const quantity = z.coerce
  .number()
  .finite()
  .positive()
  .max(100_000_000)
  .refine(
    (value) => Math.abs(value - Math.round(value * 1000) / 1000) < 1e-8,
    "Use at most three decimal places",
  );
const unit = z.enum(["kg", "meter", "roll", "piece"]);
const listingInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(20).max(5000),
    material: z.string().trim().min(2).max(80),
    condition: z.string().trim().min(2).max(80),
    unit,
    quantity,
    minOrderQuantity: quantity,
    pricePerUnit: money,
  })
  .strict()
  .refine((data) => data.minOrderQuantity <= data.quantity, {
    path: ["minOrderQuantity"],
    message: "Minimum order must not exceed available quantity",
  });
const requirementInput = z
  .object({
    material: z.string().trim().min(2).max(80),
    minQuantity: quantity,
    unit,
    maxPricePerUnit: money.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

async function requireSeller(userId, organizationId, client = { query }) {
  const result = await client.query(
    `SELECT m.role FROM app.organization_memberships m JOIN app.organizations o ON o.id=m.organization_id
     JOIN app.users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND o.status='active'
       AND u.status='active' AND u.email_verified_at IS NOT NULL`,
    [userId, organizationId],
  );
  if (!result.rowCount || !["owner", "manager"].includes(result.rows[0].role))
    throw new AppError(
      403,
      "SELLER_ACCESS_DENIED",
      "Only an active Owner or Manager can manage listings",
    );
}

async function requirePlatformReviewer(userId, client = { query }) {
  const result = await client.query(
    `SELECT 1 FROM app.platform_assignments p JOIN app.users u ON u.id=p.user_id
     WHERE p.user_id=$1 AND p.role='platform_admin' AND u.status='active' AND u.email_verified_at IS NOT NULL`,
    [userId],
  );
  if (!result.rowCount)
    throw new AppError(
      403,
      "PLATFORM_ACCESS_DENIED",
      "Platform review access required",
    );
}

async function sellerGuard(req, _res, next) {
  try {
    await requireSeller(req.auth.sub, uuid.parse(req.params.organizationId));
    next();
  } catch (error) {
    next(error);
  }
}

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

function checkZipSize(buffer) {
  let footer = -1;
  for (
    let position = buffer.length - 22;
    position >= Math.max(0, buffer.length - 65557);
    position--
  ) {
    if (buffer.readUInt32LE(position) === 0x06054b50) {
      footer = position;
      break;
    }
  }
  if (footer < 0)
    throw new AppError(422, "INVALID_FILE", "Invalid XLSX archive");
  const count = buffer.readUInt16LE(footer + 10);
  if (count > 100 || count === 0)
    throw new AppError(422, "IMPORT_SIZE", "XLSX archive has too many parts");
  let cursor = buffer.readUInt32LE(footer + 16),
    total = 0;
  for (let index = 0; index < count; index++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw new AppError(422, "INVALID_FILE", "Invalid XLSX archive");
    total += buffer.readUInt32LE(cursor + 24);
    if (total > 8 * 1024 * 1024)
      throw new AppError(422, "IMPORT_SIZE", "XLSX expands beyond 8 MB");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}

router.get(
  "/organizations/:organizationId/listings/import/template",
  requireAuth,
  async (req, res) => {
    await requireSeller(req.auth.sub, uuid.parse(req.params.organizationId));
    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        'attachment; filename="resourcepk-listings.csv"',
      )
      .send(`${columns.join(",")}\r\n`);
  },
);

router.post(
  "/organizations/:organizationId/listings/import/preview",
  requireAuth,
  importLimit,
  sellerGuard,
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      throw new AppError(422, "FILE_REQUIRED", "Choose a CSV or XLSX file");
    const fileName = req.file.originalname.toLowerCase();
    if (!/\.(csv|xlsx)$/.test(fileName))
      throw new AppError(
        422,
        "FILE_TYPE",
        "Only CSV and XLSX files are supported",
      );
    if (fileName.endsWith(".xlsx")) checkZipSize(req.file.buffer);
    let table;
    try {
      if (fileName.endsWith(".csv"))
        table = parseCsv(req.file.buffer, {
          bom: true,
          skip_empty_lines: false,
          max_record_size: 10000,
        });
      else table = await readXlsxFile(req.file.buffer);
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
    res.json({
      data: {
        rows: valid,
        errors,
        validCount: valid.length,
        invalidCount: errors.length,
      },
    });
  },
);

router.post(
  "/organizations/:organizationId/listings/import/commit",
  requireAuth,
  importLimit,
  async (req, res) => {
    const organizationId = uuid.parse(req.params.organizationId);
    const input = z
      .object({ requestKey: uuid, rows: z.array(z.unknown()) })
      .strict()
      .parse(req.body);
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
    const result = await transaction(async (client) => {
      await requireSeller(req.auth.sub, organizationId, client);
      const batch = await client.query(
        `INSERT INTO app.listing_import_batches(organization_id,created_by,request_key,payload_hash,listing_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,request_key) DO NOTHING RETURNING id`,
        [
          organizationId,
          req.auth.sub,
          input.requestKey,
          payloadHash,
          valid.length,
        ],
      );
      if (!batch.rowCount) {
        const existing = await client.query(
          `SELECT payload_hash,listing_count FROM app.listing_import_batches WHERE organization_id=$1 AND request_key=$2`,
          [organizationId, input.requestKey],
        );
        if (existing.rows[0].payload_hash !== payloadHash)
          throw new AppError(
            409,
            "IMPORT_KEY_REUSED",
            "This import key was used with different rows",
          );
        return { created: existing.rows[0].listing_count, duplicate: true };
      }
      for (const row of valid)
        await client.query(
          `INSERT INTO app.listings(organization_id,created_by,title,description,material,condition,unit,quantity,min_order_quantity,price_per_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            organizationId,
            req.auth.sub,
            row.title,
            row.description,
            row.material,
            row.condition,
            row.unit,
            row.quantity,
            row.minOrderQuantity,
            row.pricePerUnit,
          ],
        );
      return { created: valid.length, duplicate: false };
    });
    res.status(result.duplicate ? 200 : 201).json({ data: result });
  },
);

router.get("/listings", async (req, res) => {
  const filters = z
    .object({
      q: z.string().trim().max(120).optional(),
      material: z.string().trim().max(80).optional(),
      unit: unit.optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
      sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
    })
    .parse(req.query);
  const clauses = ["l.status='published'"];
  const args = [];
  if (filters.q) {
    args.push(filters.q);
    clauses.push(
      `to_tsvector('simple',l.title || ' ' || l.description || ' ' || l.material) @@ plainto_tsquery('simple',$${args.length})`,
    );
  }
  if (filters.material) {
    args.push(filters.material);
    clauses.push(`lower(l.material)=lower($${args.length})`);
  }
  if (filters.unit) {
    args.push(filters.unit);
    clauses.push(`l.unit=$${args.length}`);
  }
  const order = {
    newest: "l.created_at DESC,l.id DESC",
    price_asc: "l.price_per_unit ASC,l.id DESC",
    price_desc: "l.price_per_unit DESC,l.id DESC",
  }[filters.sort];
  const where = clauses.join(" AND ");
  const count = await query(
    `SELECT count(*)::int AS total FROM app.listings l WHERE ${where}`,
    args,
  );
  const rows = await query(
    `SELECT l.id,l.title,l.description,l.material,l.condition,l.unit,l.quantity,l.min_order_quantity,l.price_per_unit,l.created_at,o.name AS organization_name
     FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id
     WHERE ${where} ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, filters.limit, (filters.page - 1) * filters.limit],
  );
  res.json({
    data: {
      items: rows.rows,
      total: count.rows[0].total,
      page: filters.page,
      limit: filters.limit,
    },
  });
});

router.get("/listings/:listingId", async (req, res) => {
  const result = await query(
    `SELECT l.id,l.title,l.description,l.material,l.condition,l.unit,l.quantity,l.min_order_quantity,l.price_per_unit,l.created_at,o.name AS organization_name
     FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE l.id=$1 AND l.status='published'`,
    [uuid.parse(req.params.listingId)],
  );
  if (!result.rowCount)
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing unavailable");
  res.json({ data: result.rows[0] });
});

router.get(
  "/organizations/:organizationId/listings",
  requireAuth,
  async (req, res) => {
    const id = uuid.parse(req.params.organizationId);
    await requireSeller(req.auth.sub, id);
    const result = await query(
      `SELECT * FROM app.listings WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [id],
    );
    res.json({ data: result.rows });
  },
);

router.post(
  "/organizations/:organizationId/listings",
  requireAuth,
  async (req, res) => {
    const id = uuid.parse(req.params.organizationId);
    const input = listingInput.parse(req.body);
    await requireSeller(req.auth.sub, id);
    const result = await query(
      `INSERT INTO app.listings(organization_id,created_by,title,description,material,condition,unit,quantity,min_order_quantity,price_per_unit)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        req.auth.sub,
        input.title,
        input.description,
        input.material,
        input.condition,
        input.unit,
        input.quantity,
        input.minOrderQuantity,
        input.pricePerUnit,
      ],
    );
    res.status(201).json({ data: result.rows[0] });
  },
);

router.put(
  "/organizations/:organizationId/listings/:listingId",
  requireAuth,
  async (req, res) => {
    const org = uuid.parse(req.params.organizationId),
      id = uuid.parse(req.params.listingId);
    const input = listingInput.parse(req.body);
    await requireSeller(req.auth.sub, org);
    const result = await query(
      `UPDATE app.listings SET title=$3,description=$4,material=$5,condition=$6,unit=$7,quantity=$8,min_order_quantity=$9,price_per_unit=$10,updated_at=now()
     WHERE id=$1 AND organization_id=$2 AND status IN ('draft','rejected') RETURNING *`,
      [
        id,
        org,
        input.title,
        input.description,
        input.material,
        input.condition,
        input.unit,
        input.quantity,
        input.minOrderQuantity,
        input.pricePerUnit,
      ],
    );
    if (!result.rowCount)
      throw new AppError(
        409,
        "LISTING_NOT_EDITABLE",
        "Only draft or rejected listings can be edited",
      );
    res.json({ data: result.rows[0] });
  },
);

router.post(
  "/organizations/:organizationId/listings/:listingId/submit",
  requireAuth,
  async (req, res) => {
    const org = uuid.parse(req.params.organizationId),
      id = uuid.parse(req.params.listingId);
    await requireSeller(req.auth.sub, org);
    const result = await query(
      `UPDATE app.listings SET status='pending_review',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('draft','rejected') RETURNING id,status`,
      [id, org],
    );
    if (!result.rowCount)
      throw new AppError(
        409,
        "LISTING_NOT_SUBMITTABLE",
        "Listing is not in draft or rejected state",
      );
    res.json({ data: result.rows[0] });
  },
);

router.get("/platform/listings/pending", requireAuth, async (req, res) => {
  await requirePlatformReviewer(req.auth.sub);
  const result = await query(
    `SELECT l.*,o.name AS organization_name FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id WHERE l.status='pending_review' ORDER BY l.created_at ASC LIMIT 100`,
  );
  res.json({ data: result.rows });
});

router.post(
  "/platform/listings/:listingId/review",
  requireAuth,
  async (req, res) => {
    const id = uuid.parse(req.params.listingId);
    const { decision } = z
      .object({ decision: z.enum(["published", "rejected"]) })
      .strict()
      .parse(req.body);
    const listing = await transaction(async (client) => {
      await requirePlatformReviewer(req.auth.sub, client);
      const result = await client.query(
        `UPDATE app.listings SET status=$2,updated_at=now() WHERE id=$1 AND status='pending_review' RETURNING id,status,organization_id`,
        [id, decision],
      );
      if (!result.rowCount)
        throw new AppError(
          409,
          "LISTING_NOT_PENDING",
          "Listing is not awaiting review",
        );
      await client.query(
        `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,ip_address) VALUES($1,$2,$3,'listing',$4,$5)`,
        [
          req.auth.sub,
          result.rows[0].organization_id,
          `listing.${decision}`,
          id,
          req.ip,
        ],
      );
      return result.rows[0];
    });
    res.json({ data: listing });
  },
);

router.get("/requirements", requireAuth, async (req, res) => {
  const result = await query(
    `SELECT * FROM app.buyer_requirements WHERE buyer_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.auth.sub],
  );
  res.json({ data: result.rows });
});

router.post("/requirements", requireAuth, async (req, res) => {
  const input = requirementInput.parse(req.body);
  const result = await query(
    `INSERT INTO app.buyer_requirements(buyer_id,material,min_quantity,unit,max_price_per_unit,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      req.auth.sub,
      input.material,
      input.minQuantity,
      input.unit,
      input.maxPricePerUnit || null,
      input.notes || null,
    ],
  );
  res.status(201).json({ data: result.rows[0] });
});

router.get(
  "/requirements/:requirementId/matches",
  requireAuth,
  async (req, res) => {
    const id = uuid.parse(req.params.requirementId);
    const requirement = await query(
      `SELECT * FROM app.buyer_requirements WHERE id=$1 AND buyer_id=$2 AND status='active'`,
      [id, req.auth.sub],
    );
    if (!requirement.rowCount)
      throw new AppError(
        404,
        "REQUIREMENT_NOT_FOUND",
        "Requirement unavailable",
      );
    const r = requirement.rows[0];
    const matches = await query(
      `SELECT l.id,l.title,l.material,l.unit,l.quantity,l.min_order_quantity,l.price_per_unit,o.name AS organization_name,
       ($2::numeric >= l.min_order_quantity) AS direct_purchase_eligible
     FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id
     WHERE l.status='published' AND lower(l.material)=lower($1) AND l.unit=$3 AND l.quantity >= $2
       AND ($4::numeric IS NULL OR l.price_per_unit <= $4)
     ORDER BY l.created_at DESC LIMIT 50`,
      [r.material, r.min_quantity, r.unit, r.max_price_per_unit],
    );
    res.json({
      data: {
        requirement: r,
        items: matches.rows,
        explanation:
          "Same material and unit, enough stock, and within your price limit when set. Below MOQ means group buying would be needed; checkout is not yet implemented.",
      },
    });
  },
);

module.exports = router;
