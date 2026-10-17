const { z } = require("zod");
const service = require("../modules/purchases/service");
const {
  quantity,
  uuid,
  paginationInput,
} = require("../modules/catalog/validation");
const { AppError } = require("../lib/errors");

const groupCreate = z
  .object({
    listingId: uuid,
    targetQuantity: quantity,
    closesAt: z.string().datetime({ offset: true }),
    requestKey: uuid,
  })
  .strict();
const orderCreate = z
  .object({ listingId: uuid, quantity, requestKey: uuid })
  .strict();
const contributionCreate = z.object({ quantity, requestKey: uuid }).strict();
const decisionInput = z
  .object({
    decision: z.enum(["confirm", "reject"]),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
const groupDecisionInput = z
  .object({
    decision: z.enum(["confirm", "expire"]),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
const id = (value) => uuid.parse(value);
const page = (req) => paginationInput.parse(req.query);

async function createDirect(req, res) {
  res.status(201).json({
    data: await service.createDirectOrder(
      req.auth.sub,
      orderCreate.parse(req.body),
      req.correlationId,
    ),
  });
}

async function myOrders(req, res) {
  const pagination = page(req);
  res.json({
    data: await service.buyerOrders(
      req.auth.sub,
      pagination.page,
      pagination.limit,
    ),
  });
}

async function listSellerOrders(req, res) {
  const pagination = page(req);
  res.json({
    data: await service.sellerOrders(
      req.auth.sub,
      id(req.params.organizationId),
      pagination.page,
      pagination.limit,
    ),
  });
}

async function sellerOrderDecision(req, res) {
  const input = decisionInput.parse(req.body);
  const result = await service.sellerDecision(
    req.auth.sub,
    id(req.params.organizationId),
    id(req.params.orderId),
    input.decision,
    input.reason || null,
    req.correlationId,
  );
  if (result.expired)
    throw new AppError(
      409,
      "SELLER_RESPONSE_EXPIRED",
      "The Seller response deadline passed; the reservation was released",
    );
  res.json({ data: result.order });
}

async function createSellerGroup(req, res) {
  res.status(201).json({
    data: await service.createGroup(
      req.auth.sub,
      id(req.params.organizationId),
      groupCreate.parse(req.body),
    ),
  });
}

async function listSellerGroups(req, res) {
  const pagination = page(req);
  res.json({
    data: await service.organizationGroups(
      req.auth.sub,
      id(req.params.organizationId),
      pagination.page,
      pagination.limit,
    ),
  });
}

async function sellerGroupDecision(req, res) {
  const input = groupDecisionInput.parse(req.body);
  res.json({
    data: await service.decideGroup(
      req.auth.sub,
      id(req.params.organizationId),
      id(req.params.groupId),
      input.decision,
      input.reason || null,
      req.correlationId,
    ),
  });
}

async function listGroups(req, res) {
  const pagination = page(req);
  res.json({
    data: await service.listOpenGroups(
      id(req.params.listingId),
      pagination.page,
      pagination.limit,
    ),
  });
}

async function groupDetail(req, res) {
  res.json({
    data: await service.buyerGroupDetail(req.auth.sub, id(req.params.groupId)),
  });
}

async function joinGroup(req, res) {
  res.status(201).json({
    data: await service.joinGroup(
      req.auth.sub,
      id(req.params.groupId),
      contributionCreate.parse(req.body),
      req.correlationId,
    ),
  });
}

async function leaveGroup(req, res) {
  res.json({
    data: await service.leaveGroup(
      req.auth.sub,
      id(req.params.groupId),
      id(req.params.orderId),
      req.correlationId,
    ),
  });
}

module.exports = {
  createDirect,
  myOrders,
  listSellerOrders,
  sellerOrderDecision,
  createSellerGroup,
  listSellerGroups,
  sellerGroupDecision,
  listGroups,
  groupDetail,
  joinGroup,
  leaveGroup,
};
