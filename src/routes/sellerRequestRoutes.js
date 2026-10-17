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
router.get(
  "/platform/reviewer-invitations/details",
  limiter,
  controller.reviewerInvitationDetails,
);
router.post(
  "/platform/reviewer-invitations/accept-new",
  limiter,
  controller.acceptReviewerInvitationNew,
);
router.post(
  "/platform/reviewer-invitations/accept",
  requireAuth,
  limiter,
  controller.acceptReviewerInvitationExisting,
);
router.put(
  "/platform/reviewers/:userId/permissions",
  requireAuth,
  limiter,
  controller.setReviewerPermissions,
);
router.post(
  "/platform/reviewers",
  requireAuth,
  limiter,
  controller.inviteReviewer,
);
router.delete(
  "/platform/reviewers/:userId",
  requireAuth,
  limiter,
  controller.revokeReviewer,
);

module.exports = router;
