const { z } = require("zod");
const service = require("../services/sellerRequestService");

const requestBody = z
  .object({ organizationName: z.string().trim().min(2).max(180) })
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
  res.status(201).json({
    data: await service.submit(
      req.auth.sub,
      requestBody.parse(req.body).organizationName,
      meta(req),
    ),
  });
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

async function assignReviewer(req, res) {
  res.status(201).json({
    data: await service.assignReviewer(
      req.auth.sub,
      emailBody.parse(req.body).email,
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

module.exports = { submit, mine, list, decide, assignReviewer, revokeReviewer };
