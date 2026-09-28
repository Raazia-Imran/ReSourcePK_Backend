const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middlewares/authMiddleware");

const sensitive = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/register", sensitive, controller.register);
router.post("/verify-email", sensitive, controller.verifyEmail);
router.post("/resend-verification", sensitive, controller.resendVerification);
router.post("/login", sensitive, controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
router.post("/forgot-password", sensitive, controller.forgotPassword);
router.post("/reset-password", sensitive, controller.resetPassword);
router.get("/me", requireAuth, controller.me);

module.exports = router;
