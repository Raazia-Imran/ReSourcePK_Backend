const express = require("express");
const { requireAuth } = require("../middlewares/authMiddleware");
const controller = require("../controllers/workspaceDataController");

const router = express.Router();
router.get("/analytics/buyer-impact", requireAuth, controller.buyerImpact);
router.get(
  "/organizations/:organizationId/analytics",
  requireAuth,
  controller.organizationAnalytics,
);
router.get(
  "/organizations/:organizationId/settings",
  requireAuth,
  controller.getOrganizationSettings,
);
router.patch(
  "/organizations/:organizationId/settings",
  requireAuth,
  controller.updateOrganizationSettings,
);
router.get(
  "/platform/organizations",
  requireAuth,
  controller.platformOrganizations,
);
router.get("/platform/users", requireAuth, controller.platformUsers);
router.get("/platform/analytics", requireAuth, controller.platformAnalytics);

module.exports = router;
