const express = require("express");
const { requireCron } = require("../middlewares/cronAuth");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");
const cleanup = require("../modules/catalog/imageCleanupService");

const router = express.Router();
router.all("/internal/storage-cleanup", requireCron, async (req, res) => {
  if (req.method !== "GET") {
    res.set("Allow", "GET");
    throw new AppError(
      405,
      "METHOD_NOT_ALLOWED",
      "Use GET for the scheduled job",
    );
  }
  if (!env.SUPABASE_URL)
    throw new AppError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Configure private image storage first",
    );
  const result = await cleanup.cleanImageObjects();
  console.info(
    JSON.stringify({
      level: result.failed ? "error" : "info",
      event: "image_cleanup",
      correlationId: req.correlationId,
      ...result,
    }),
  );
  if (result.failed)
    throw new AppError(
      503,
      "IMAGE_CLEANUP_INCOMPLETE",
      "Image cleanup will need another run",
    );
  res.json({ data: result });
});

module.exports = router;
