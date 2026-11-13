const { z } = require("zod");
const service = require("../modules/orders/service");
const { uuid } = require("../modules/catalog/validation");

const transitionInput = z
  .object({
    toStatus: z.enum(["processing", "ready", "dispatched"]),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();

const id = (value) => uuid.parse(value);

async function sellerTransition(req, res) {
  const input = transitionInput.parse(req.body);

  const order = await service.transitionOrder(
    id(req.params.orderId),
    req.auth.sub,
    input.toStatus,
    input.reason || null,
    req.correlationId,
    "seller",
    id(req.params.organizationId),
  );

  res.json({ data: order });
}

async function confirmReceipt(req, res) {
  const input = z
    .object({
      reason: z.string().trim().min(3).max(1000).optional(),
    })
    .strict()
    .parse(req.body);

  const order = await service.confirmReceipt(
    id(req.params.orderId),
    req.auth.sub,
    input.reason || null,
    req.correlationId,
  );

  res.json({ data: order });
}

async function buyerCancelOrder(req, res) {
  const input = z
    .object({
      reason: z.string().trim().min(3).max(1000).optional(),
    })
    .strict()
    .parse(req.body);

  const order = await service.cancelOrder(
    id(req.params.orderId),
    req.auth.sub,
    input.reason || null,
    req.correlationId,
    "buyer",
  );

  res.json({ data: order });
}

async function sellerCancelOrder(req, res) {
  const input = z
    .object({
      reason: z.string().trim().min(3).max(1000).optional(),
    })
    .strict()
    .parse(req.body);

  const order = await service.cancelOrder(
    id(req.params.orderId),
    req.auth.sub,
    input.reason || null,
    req.correlationId,
    "seller",
    id(req.params.organizationId),
  );

  res.json({ data: order });
}

async function raiseDispute(req, res) {
  const schema = z
    .object({
      reason: z.string().trim().min(3).max(1000),
    })
    .strict();

  const input = schema.parse(req.body);

  const actorType = req.params.organizationId ? "seller" : "buyer";

  const order = await service.raiseDispute(
    id(req.params.orderId),
    req.auth.sub,
    input.reason,
    req.correlationId,
    actorType,
    actorType === "seller" ? id(req.params.organizationId) : null,
  );

  res.json({ data: order });
}

//new addition

async function simulateRefund(req, res) {
  const schema = z
    .object({
      reason: z.string().trim().min(3).max(1000),
    })
    .strict();

  const input = schema.parse(req.body);

  const order = await service.simulateRefund(
    id(req.params.orderId),
    req.auth.sub,
    input.reason,
    req.correlationId,
  );

  res.json({ data: order });
}

// module.exports = {
//   sellerTransition,
//   confirmReceipt,
//   buyerCancelOrder,
//   sellerCancelOrder,
//   raiseDispute,
// };

module.exports = {
  sellerTransition,
  confirmReceipt,
  buyerCancelOrder,
  sellerCancelOrder,
  raiseDispute,
  simulateRefund,
};
