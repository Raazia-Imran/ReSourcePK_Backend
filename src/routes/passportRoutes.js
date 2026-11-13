const express = require("express");
const rateLimit = require("express-rate-limit");
const { env } = require("../config/env");
const { requireAuth } = require("../middlewares/authMiddleware");
const controller = require("../controllers/passportController");

const router = express.Router();

const publicLimit = rateLimit({
  windowMs: 60000,
  limit: env.PUBLIC_READS_PER_MINUTE,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.get(
  "/public/passports/:passportId/verification",
  publicLimit,
  controller.getVerification,
);

router.post(
  "/platform/passports/:passportId/retry-anchor",
  requireAuth,
  controller.retryAnchor,
);

module.exports = router;
