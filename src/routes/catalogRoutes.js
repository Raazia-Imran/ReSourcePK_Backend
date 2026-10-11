const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { requireAuth } = require("../middlewares/authMiddleware");
const service = require("../modules/catalog/service");
const repo = require("../modules/catalog/repository");
const importer = require("../modules/catalog/importService");
const {
  uuid,
  unit,
  listingInput,
  requirementInput,
  paginationInput,
} = require("../modules/catalog/validation");
const router = express.Router();
const { env } = require("../config/env");
const publicLimit = rateLimit({
  windowMs: 60000,
  limit: env.PUBLIC_READS_PER_MINUTE,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
});
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 1000 },
});
const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.auth.sub,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const versionInput = z
  .object({ version: z.coerce.number().int().positive() })
  .strict();
const imageInput = versionInput.extend({
  altText: z.string().trim().min(1).max(200),
});
const reviewInput = versionInput.extend({
  decision: z.enum(["published", "rejected"]),
  reason: z.string().trim().min(3).max(1000),
});
const searchInput = z
  .object({
    q: z.string().trim().max(120).optional(),
    material: z.string().trim().max(80).optional(),
    unit: unit.optional(),
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  })
  .strict();
const org = (req) => uuid.parse(req.params.organizationId);
const id = (req) => uuid.parse(req.params.listingId);
const send = (res, data) => res.json({ data });
async function sellerGuard(req, _res, next) {
  try {
    await service.requireSeller(req.auth.sub, org(req));
    next();
  } catch (error) {
    next(error);
  }
}
router.get("/listings", publicLimit, async (req, res) =>
  send(res, await repo.search(searchInput.parse(req.query))),
);
router.get("/listings/:listingId", publicLimit, async (req, res) =>
  send(res, await service.publicListing(id(req))),
);
router.get(
  "/listing-images/:imageId",
  publicLimit,
  async (req, res, next) => {
    if (req.get("authorization")) return requireAuth(req, res, next);
    next();
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    send(
      res,
      await service.imageUrl(req.auth?.sub, uuid.parse(req.params.imageId)),
    );
  },
);
router.get(
  "/organizations/:organizationId/listings/import/template",
  requireAuth,
  sellerGuard,
  (_req, res) =>
    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        'attachment; filename="resourcepk-listings.csv"',
      )
      .send(importer.columns.join(",") + "\r\n"),
);
router.post(
  "/organizations/:organizationId/listings/import/preview",
  requireAuth,
  uploadLimit,
  sellerGuard,
  importUpload.single("file"),
  async (req, res) => send(res, await importer.preview(req.file)),
);
router.post(
  "/organizations/:organizationId/listings/import/commit",
  requireAuth,
  uploadLimit,
  async (req, res) => {
    const input = z
      .object({ requestKey: uuid, rows: z.array(z.unknown()).min(1).max(100) })
      .strict()
      .parse(req.body);
    const result = await importer.commit(req.auth.sub, org(req), input);
    res.status(result.duplicate ? 200 : 201);
    send(res, result);
  },
);
router.get(
  "/organizations/:organizationId/listings",
  requireAuth,
  async (req, res) =>
    send(
      res,
      await service.listSeller(
        req.auth.sub,
        org(req),
        paginationInput.parse(req.query),
      ),
    ),
);
router.post(
  "/organizations/:organizationId/listings",
  requireAuth,
  async (req, res) => {
    res.status(201);
    send(
      res,
      await service.create(
        req.auth.sub,
        org(req),
        listingInput.parse(req.body),
      ),
    );
  },
);
router.put(
  "/organizations/:organizationId/listings/:listingId",
  requireAuth,
  async (req, res) => {
    const { version, ...body } = req.body || {};
    const versionNumber = versionInput.parse({ version }).version;
    send(
      res,
      await service.edit(
        req.auth.sub,
        org(req),
        id(req),
        listingInput.parse(body),
        versionNumber,
      ),
    );
  },
);
for (const [action, status] of [
  ["submit", "pending_review"],
  ["archive", "archived"],
])
  router.post(
    `/organizations/:organizationId/listings/:listingId/${action}`,
    requireAuth,
    async (req, res) =>
      send(
        res,
        await service.transition(
          req.auth.sub,
          org(req),
          id(req),
          status,
          versionInput.parse(req.body).version,
        ),
      ),
  );
router.post(
  "/organizations/:organizationId/listings/:listingId/images",
  requireAuth,
  uploadLimit,
  sellerGuard,
  imageUpload.single("file"),
  async (req, res) => {
    const input = imageInput.parse(req.body);
    res.status(201);
    send(
      res,
      await service.addImage(
        req.auth.sub,
        org(req),
        id(req),
        req.file,
        input.altText,
        input.version,
      ),
    );
  },
);
router.delete(
  "/organizations/:organizationId/listings/:listingId/images/:imageId",
  requireAuth,
  async (req, res) =>
    send(
      res,
      await service.deleteImage(
        req.auth.sub,
        org(req),
        id(req),
        uuid.parse(req.params.imageId),
        versionInput.parse(req.body).version,
      ),
    ),
);
router.get("/platform/listings/pending", requireAuth, async (req, res) =>
  send(
    res,
    await service.pending(req.auth.sub, paginationInput.parse(req.query)),
  ),
);
router.post(
  "/platform/listings/:listingId/review",
  requireAuth,
  async (req, res) => {
    const input = reviewInput.parse(req.body);
    send(
      res,
      await service.review(
        req.auth.sub,
        id(req),
        input.decision,
        input.reason,
        input.version,
      ),
    );
  },
);
router.get("/requirements", requireAuth, async (req, res) =>
  send(
    res,
    await repo.requirements(req.auth.sub, paginationInput.parse(req.query)),
  ),
);
router.post("/requirements", requireAuth, async (req, res) => {
  res.status(201);
  send(
    res,
    await service.createRequirement(
      req.auth.sub,
      requirementInput.parse(req.body),
    ),
  );
});
router.patch(
  "/requirements/:requirementId/status",
  requireAuth,
  async (req, res) => {
    const input = versionInput
      .extend({ status: z.enum(["active", "paused", "closed"]) })
      .parse(req.body);
    send(
      res,
      await service.requirementStatus(
        req.auth.sub,
        uuid.parse(req.params.requirementId),
        input.status,
        input.version,
      ),
    );
  },
);
router.get(
  "/requirements/:requirementId/matches",
  requireAuth,
  async (req, res) =>
    send(
      res,
      await repo.matches(req.auth.sub, uuid.parse(req.params.requirementId)),
    ),
);
module.exports = router;
