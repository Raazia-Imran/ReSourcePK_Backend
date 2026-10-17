const express = require("express");
const controller = require("../controllers/organizationController");
const { requireAuth } = require("../middlewares/authMiddleware");
const router = express.Router();

router.post("/organizations", requireAuth, controller.createOrganization);

router.get("/invitations/details", controller.invitationDetails);
router.post("/invitations/accept-new", controller.acceptNewUser);
router.post("/invitations/accept", requireAuth, controller.acceptExistingUser);
router.post(
  "/organizations/:organizationId/invitations",
  requireAuth,
  controller.createInvitation,
);
router.get(
  "/organizations/:organizationId/members",
  requireAuth,
  controller.listMembers,
);
router.patch(
  "/organizations/:organizationId/members/:membershipId/permissions",
  requireAuth,
  controller.setStaffPermissions,
);

module.exports = router;
