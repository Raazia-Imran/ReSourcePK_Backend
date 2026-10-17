const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middlewares/authMiddleware");
const { cookieMutation } = require("../middlewares/cookieMutation");
const { env } = require("../config/env");

const sensitive = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_REQUESTS_PER_WINDOW,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/register", sensitive, controller.register);
router.post("/verify-email", sensitive, controller.verifyEmail);
router.post("/resend-verification", sensitive, controller.resendVerification);
router.post("/login", sensitive, controller.login);
router.get("/google/nonce", sensitive, controller.googleNonce);
router.post("/google", sensitive, controller.googleLogin);
router.get("/google/seller/nonce", sensitive, controller.googleSellerNonce);
router.post("/google/seller", sensitive, controller.googleSellerLogin);
router.get(
  "/google/link/nonce",
  requireAuth,
  sensitive,
  controller.googleLinkNonce,
);
router.post("/google/link", requireAuth, sensitive, controller.linkGoogle);
router.post("/refresh", cookieMutation, sensitive, controller.refresh);
router.post("/logout", cookieMutation, controller.logout);
router.post("/forgot-password", sensitive, controller.forgotPassword);
router.post("/reset-password", sensitive, controller.resetPassword);
router.get("/me", requireAuth, controller.me);

module.exports = router;
