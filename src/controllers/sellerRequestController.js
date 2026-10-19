const { z } = require("zod");
const service = require("../services/sellerRequestService");
const { strongPassword } = require("../lib/password");
const cnicNumber = z
  .string()
  .trim()
  .regex(/^(?:\d{13}|\d{5}-\d{7}-\d|\d{5}\s\d{7}\s\d)$/);

const requestBody = z
  .object({
    applicantName: z.string().trim().min(2).max(120),
    cnicNumber,
    organizationName: z.string().trim().min(2).max(180),
    contactNumber: z.string().trim().min(7).max(32),
    businessAddress: z.string().trim().min(5).max(500),
  })
  .strict();
const decisionBody = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reviewNote: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.decision !== "rejected" || (body.reviewNote || "").length >= 3,
    { message: "A short reason is required when rejecting a request" },
  );
const uuid = z.string().uuid();
const emailBody = z.object({ email: z.string().email().max(254) }).strict();
const reviewerPermissions = z
  .object({
    permissions: z
      .array(z.enum(["seller_requests.review", "listings.review"]))
      .max(2),
  })
  .strict();
const reviewerInviteBody = emailBody.extend({
  permissions: z
    .array(z.enum(["seller_requests.review", "listings.review"]))
    .max(2)
    .default([]),
});
const reviewerAcceptNewBody = z
  .object({
    token: z.string().min(32).max(200),
    fullName: z.string().trim().min(2).max(120),
    password: strongPassword,
  })
  .strict();
const invitationToken = z
  .object({ token: z.string().min(32).max(200) })
  .strict();
const querySchema = z
  .object({
    status: z
      .enum(["pending", "approved", "rejected", "all"])
      .default("pending"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

const meta = (req) => ({ ip: req.ip });

async function submit(req, res) {
  const result = await service.submit(
    req.auth.sub,
    requestBody.parse(req.body),
    meta(req),
  );
  const status = result.wasUpdated ? 200 : 201;
  delete result.wasUpdated;
  res.status(status).json({ data: result });
}

async function mine(req, res) {
  res.json({ data: await service.mine(req.auth.sub) });
}

async function list(req, res) {
  res.json({
    data: await service.list(req.auth.sub, querySchema.parse(req.query)),
  });
}

async function decide(req, res) {
  const body = decisionBody.parse(req.body);
  res.json({
    data: await service.decide(
      req.auth.sub,
      uuid.parse(req.params.requestId),
      body.decision,
      body.reviewNote,
      meta(req),
    ),
  });
}

async function inviteReviewer(req, res) {
  const body = reviewerInviteBody.parse(req.body);
  res.status(201).json({
    data: await service.inviteReviewer(
      req.auth.sub,
      body.email,
      body.permissions,
    ),
  });
}

async function acceptReviewerInvitationNew(req, res) {
  const body = reviewerAcceptNewBody.parse(req.body);
  res.status(201).json({
    data: await service.acceptReviewerInvitationNew(
      body.token,
      body.fullName,
      body.password,
    ),
  });
}

async function reviewerInvitationDetails(req, res) {
  const token = z.string().min(32).max(200).parse(req.query.token);
  res.json({ data: await service.reviewerInvitationDetails(token) });
}

async function acceptReviewerInvitationExisting(req, res) {
  const body = invitationToken.parse(req.body);
  res.json({
    data: await service.acceptReviewerInvitationExisting(
      req.auth.sub,
      body.token,
    ),
  });
}

async function setReviewerPermissions(req, res) {
  const body = reviewerPermissions.parse(req.body);
  res.json({
    data: await service.setReviewerPermissions(
      req.auth.sub,
      uuid.parse(req.params.userId),
      body.permissions,
    ),
  });
}

async function revokeReviewer(req, res) {
  res.json({
    data: await service.revokeReviewer(
      req.auth.sub,
      uuid.parse(req.params.userId),
    ),
  });
}

module.exports = {
  submit,
  mine,
  list,
  decide,
  revokeReviewer,
  inviteReviewer,
  acceptReviewerInvitationNew,
  reviewerInvitationDetails,
  acceptReviewerInvitationExisting,
  setReviewerPermissions,
};
