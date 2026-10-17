const { z } = require("zod");
const service = require("../services/organizationService");

const { strongPassword: password } = require("../lib/password");
const invite = z
  .object({
    email: z.string().email().max(254),
    role: z.enum(["manager", "staff"]),
    canInviteStaff: z.boolean().default(false),
  })
  .strict();
const token = z.string().min(32).max(200);
const meta = (req) => ({ ip: req.ip });

async function createInvitation(req, res) {
  res.status(201).json({
    data: await service.createInvitation(
      req.auth.sub,
      z.string().uuid().parse(req.params.organizationId),
      invite.parse(req.body),
      meta(req),
    ),
  });
}
async function createOrganization() {
  await service.createOrganization();
}
async function invitationDetails(req, res) {
  res.json({
    data: await service.invitationDetails(token.parse(req.query.token)),
  });
}
async function acceptNewUser(req, res) {
  const body = z
    .object({ token, fullName: z.string().trim().min(2).max(120), password })
    .strict()
    .parse(req.body);
  res
    .status(201)
    .json({ data: await service.acceptNewUser(body.token, body, meta(req)) });
}
async function acceptExistingUser(req, res) {
  const body = z.object({ token }).strict().parse(req.body);
  res.json({
    data: await service.acceptExistingUser(req.auth.sub, body.token, meta(req)),
  });
}

module.exports = {
  createOrganization,
  createInvitation,
  invitationDetails,
  acceptNewUser,
  acceptExistingUser,
};
