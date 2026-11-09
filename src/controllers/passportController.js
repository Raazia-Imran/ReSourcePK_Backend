const { z } = require("zod");
const service = require("../modules/passports/verificationService");

const retryInput = z
  .object({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

async function getVerification(req, res, next) {
  try {
    const data = await service.getPublicVerification(
      req.params.passportId,
    );

    return res.json({ data });
  } catch (error) {
    return next(error);
  }
}

async function retryAnchor(req, res, next) {
  try {
    const { reason } = retryInput.parse(req.body);

    const data = await service.retryPassportAnchor(
      req.params.passportId,
      req.auth.sub,
      reason,
      req.ip,
    );

    return res.json({ data });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getVerification,
  retryAnchor,
};