const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/sellerRequestController");
const { requireAuth } = require("../middlewares/authMiddleware");
const { env } = require("../config/env");

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_REQUESTS_PER_WINDOW,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/seller/requests", requireAuth, limiter, controller.submit);
router.get("/seller/requests/mine", requireAuth, controller.mine);
router.get("/platform/seller-requests", requireAuth, controller.list);
router.post(
  "/platform/seller-requests/:requestId/decision",
  requireAuth,
  limiter,
  controller.decide,
);
router.post(
  "/platform/reviewers",
  requireAuth,
  limiter,
  controller.assignReviewer,
);
router.delete(
  "/platform/reviewers/:userId",
  requireAuth,
  limiter,
  controller.revokeReviewer,
);

module.exports = router;
