const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middlewares/authMiddleware");
const { env } = require("../config/env");
const controller = require("../controllers/orderController");

const router = express.Router();

const mutationLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_REQUESTS_PER_WINDOW,
  keyGenerator: (req) => req.auth.sub,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post(
  "/organizations/:organizationId/orders/:orderId/fulfilment",
  requireAuth,
  mutationLimit,
  controller.sellerTransition,
);

router.post(
  "/orders/:orderId/confirm-receipt",
  requireAuth,
  mutationLimit,
  controller.confirmReceipt,
);

router.post(
  "/orders/:orderId/cancel",
  requireAuth,
  mutationLimit,
  controller.buyerCancelOrder,
);

router.post(
  "/organizations/:organizationId/orders/:orderId/cancel",
  requireAuth,
  mutationLimit,
  controller.sellerCancelOrder,
);

// // Buyer raises a dispute
// router.post(
//   "/orders/:orderId/dispute",
//   authMiddleware,
//   mutationRateLimit,
//   orderController.raiseDispute,
// );

// // Seller raises a dispute
// router.post(
//   "/organizations/:organizationId/orders/:orderId/dispute",
//   authMiddleware,
//   mutationRateLimit,
//   orderController.raiseDispute,
// );


// Buyer raises a dispute
router.post(
  "/orders/:orderId/dispute",
  requireAuth,
  mutationLimit,
  controller.raiseDispute,
);

// Seller raises a dispute
router.post(
  "/organizations/:organizationId/orders/:orderId/dispute",
  requireAuth,
  mutationLimit,
  controller.raiseDispute,
);

// Platform Admin simulates an order refund
// router.post(
//   "/platform/orders/:orderId/refund-simulation",
//   authMiddleware,
//   mutationRateLimit,
//   orderController.simulateRefund,
// );

// Platform Admin simulates an order refund
router.post(
  "/platform/orders/:orderId/refund-simulation",
  requireAuth,
  mutationLimit,
  controller.simulateRefund,
);

module.exports = router;