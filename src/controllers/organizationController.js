const { z } = require("zod");
const service = require("../services/organizationService");

const password = z
  .string()
  .min(10)
  .max(128)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/\d/);
const invite = z.object({
  email: z.string().email(),
  role: z.enum(["org_admin", "manager", "staff"]),
  canInviteStaff: z.boolean().default(false),
});
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
async function invitationDetails(req, res) {
  res.json({
    data: await service.invitationDetails(token.parse(req.query.token)),
  });
}
async function acceptNewUser(req, res) {
  const body = z
    .object({ token, fullName: z.string().trim().min(2).max(120), password })
    .parse(req.body);
  res
    .status(201)
    .json({ data: await service.acceptNewUser(body.token, body, meta(req)) });
}
async function acceptExistingUser(req, res) {
  const body = z.object({ token }).parse(req.body);
  res.json({
    data: await service.acceptExistingUser(req.auth.sub, body.token, meta(req)),
  });
}

module.exports = {
  createInvitation,
  invitationDetails,
  acceptNewUser,
  acceptExistingUser,
};
