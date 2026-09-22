const express = require("express");
const controller = require("../controllers/organizationController");
const { requireAuth } = require("../middlewares/authMiddleware");
const router = express.Router();

router.get("/invitations/details", controller.invitationDetails);
router.post("/invitations/accept-new", controller.acceptNewUser);
router.post("/invitations/accept", requireAuth, controller.acceptExistingUser);
router.post(
  "/organizations/:organizationId/invitations",
  requireAuth,
  controller.createInvitation,
);

module.exports = router;
