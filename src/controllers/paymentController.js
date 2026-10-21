const { z } = require("zod");
const service = require("../modules/payments/service");
const { uuid } = require("../modules/catalog/validation");

const checkoutInput = z
  .object({
    requestKey: uuid,
    mobile: z
      .string()
      .trim()
      .regex(/^03\d{9}$/),
    testScenario: z
      .enum([
        "SUCCESS",
        "FAILED",
        "PENDING",
        "EXPIRED",
        "INSUFFICIENT_BALANCE",
        "INVALID_OTP",
        "TIMEOUT",
        "DUPLICATE",
      ])
      .optional(),
  })
  .strict();

async function startCheckout(req, res) {
  const result = await service.startCheckout(
    req.auth.sub,
    uuid.parse(req.params.orderId),
    checkoutInput.parse(req.body),
    req.correlationId,
  );
  res.status(201).json({ data: result });
}

async function getAttempt(req, res) {
  res.json({
    data: await service.getAttempt(
      req.auth.sub,
      uuid.parse(req.params.attemptId),
    ),
  });
}

async function webhook(req, res) {
  const result = await service.processWebhook(
    req.headers,
    req.rawBody,
    req.body,
  );
  res.json({ data: result });
}

module.exports = { startCheckout, getAttempt, webhook };
