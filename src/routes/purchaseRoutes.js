const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middlewares/authMiddleware");
const { env } = require("../config/env");
const controller = require("../controllers/purchaseController");
const paymentController = require("../controllers/paymentController");

const router = express.Router();
const mutationLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_REQUESTS_PER_WINDOW,
  keyGenerator: (req) => req.auth.sub,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/orders", requireAuth, mutationLimit, controller.createDirect);
router.get("/orders/mine", requireAuth, controller.myOrders);
router.post(
  "/orders/:orderId/checkout",
  requireAuth,
  mutationLimit,
  paymentController.startCheckout,
);
router.get(
  "/payment-attempts/:attemptId",
  requireAuth,
  paymentController.getAttempt,
);
router.post("/rapidgateway/webhook", paymentController.webhook);
router.get(
  "/organizations/:organizationId/orders",
  requireAuth,
  controller.listSellerOrders,
);
router.post(
  "/organizations/:organizationId/orders/:orderId/decision",
  requireAuth,
  mutationLimit,
  controller.sellerOrderDecision,
);

router.post(
  "/organizations/:organizationId/purchase-groups",
  requireAuth,
  mutationLimit,
  controller.createSellerGroup,
);
router.get(
  "/organizations/:organizationId/purchase-groups",
  requireAuth,
  controller.listSellerGroups,
);
router.post(
  "/organizations/:organizationId/purchase-groups/:groupId/decision",
  requireAuth,
  mutationLimit,
  controller.sellerGroupDecision,
);

router.get("/listings/:listingId/purchase-groups", controller.listGroups);
router.get("/purchase-groups/:groupId", requireAuth, controller.groupDetail);
router.post(
  "/purchase-groups/:groupId/contributions",
  requireAuth,
  mutationLimit,
  controller.joinGroup,
);
router.post(
  "/purchase-groups/:groupId/contributions/:orderId/leave",
  requireAuth,
  mutationLimit,
  controller.leaveGroup,
);

module.exports = router;
