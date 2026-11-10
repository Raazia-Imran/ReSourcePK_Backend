const { AppError } = require("../../lib/errors");

const TRANSITIONS = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "cancelled", "refunded", "disputed"],
  processing: ["ready", "cancelled", "refunded", "disputed"],
  ready: ["dispatched", "cancelled", "disputed"],
  dispatched: ["delivered", "disputed"],
  delivered: ["completed", "disputed"],
  completed: ["refunded", "disputed"],
  disputed: ["processing", "completed", "refunded", "cancelled"],
  cancelled: [],
  refunded: [],
};

function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(
      409,
      "ORDER_INVALID_TRANSITION",
      `Invalid order fulfilment transition: ${from} -> ${to}`,
    );
  }
}

module.exports = {
  TRANSITIONS,
  canTransition,
  assertTransition,
};
