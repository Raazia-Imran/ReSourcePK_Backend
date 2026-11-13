const db = require("../../db");
const { AppError } = require("../../lib/errors");
const { assertTransition } = require("./orderStateMachine");

//new addition
//{ releaseReservation } = require("../purchases/service");

//new addition
const {
  requirePlatformAdmin,
} = require("../../services/platformAccessService");

//new addition
const { createSnapshotForOrder } = require("../passports/service");

function sameId(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

async function transitionOrder(
  orderId,
  actorId,
  toStatus,
  reason,
  correlationId,
  actorType,
  organizationId = null,
) {
  return db.transaction(async (runner) => {
    const order = await lockOrder(runner, orderId, organizationId);

    if (actorType === "seller") {
      await requireOrderDecision(runner, actorId, order.organization_id);
    } else if (actorType === "buyer") {
      if (!sameId(order.buyer_id, actorId)) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
      }
    } else {
      throw new AppError(
        403,
        "ORDER_ACCESS_DENIED",
        "You are not authorized to perform this action",
      );
    }

    // Repeated requests for the current status are harmless.
    if (order.fulfilment_status === toStatus) {
      return order;
    }

    // Validate the requested state transition.
    // assertTransition(order.fulfilment_status, toStatus);

    // const sellerTransitions = [
    //   "processing",
    //   "ready",
    //   "dispatched",
    // ];

    // const buyerTransitions = [
    //   "cancelled",
    //   "delivered",
    //   "completed",
    //   "disputed",
    // ];

    // if (
    //   (actorType === "seller" && !sellerTransitions.includes(toStatus)) ||
    //   (actorType === "buyer" && !buyerTransitions.includes(toStatus))
    // ) {
    //   throw new AppError(
    //     403,
    //     "ORDER_ACTION_DENIED",
    //     "You are not authorized to perform this order action",
    //   );
    // }

    // Only sellers can use the general fulfilment transition function.
    // const sellerTransitions = [
    //   "processing",
    //   "ready",
    //   "dispatched",
    // ];

    // if (actorType !== "seller" || !sellerTransitions.includes(toStatus)) {
    //   throw new AppError(
    //     403,
    //     "ORDER_ACTION_DENIED",
    //     "You are not authorized to perform this order action",
    //   );
    // }

    // // Validate the requested state transition.
    // assertTransition(order.fulfilment_status, toStatus);

    // Validate whether the requested state transition is valid.
    assertTransition(order.fulfilment_status, toStatus);

    // Only sellers can use the general fulfilment transition function.
    const sellerTransitions = ["processing", "ready", "dispatched"];

    if (actorType !== "seller" || !sellerTransitions.includes(toStatus)) {
      throw new AppError(
        403,
        "ORDER_ACTION_DENIED",
        "You are not authorized to perform this order action",
      );
    }

    const result = await runner.query(
      `UPDATE app.orders
   SET fulfilment_status = $2,
       completed_at = CASE
         WHEN $2 = 'completed' THEN now()
         ELSE completed_at
       END
   WHERE id = $1
   RETURNING *`,
      [order.id, toStatus],
    );

    const updatedOrder = result.rows[0];

    await addOrderEvent(
      runner,
      order.id,
      actorId,
      `fulfilment.${toStatus}`,
      order.fulfilment_status,
      toStatus,
      { reason, correlationId },
    );

    if (actorType === "seller") {
      await addAudit(
        runner,
        actorId,
        order.organization_id,
        `order.fulfilment.${toStatus}`,
        "order",
        order.id,
        reason,
      );
    }

    return updatedOrder;
  });
}

async function lockOrder(runner, orderId, organizationId = null) {
  const result = await runner.query(
    `SELECT *
     FROM app.orders
     WHERE id = $1
       AND ($2::uuid IS NULL OR organization_id = $2)
     FOR UPDATE`,
    [orderId, organizationId],
  );

  if (!result.rowCount) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
  }

  return result.rows[0];
}

async function sellerMembership(runner, userId, organizationId) {
  const result = await runner.query(
    `SELECT m.id, m.role
     FROM app.organization_memberships m
     JOIN app.organizations o ON o.id=m.organization_id
     JOIN app.users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active'
       AND o.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL
     FOR SHARE OF m,o,u`,
    [userId, organizationId],
  );

  if (!result.rowCount) return null;

  const permissions = await runner.query(
    "SELECT permission FROM app.organization_membership_permissions WHERE membership_id=$1",
    [result.rows[0].id],
  );

  return {
    ...result.rows[0],
    permissions: permissions.rows.map((row) => row.permission),
  };
}

async function requireOrderDecision(runner, userId, organizationId) {
  const membership = await sellerMembership(runner, userId, organizationId);

  if (
    !membership ||
    (membership.role !== "owner" &&
      !(
        membership.role === "manager" &&
        membership.permissions.includes("orders.confirm")
      ))
  ) {
    throw new AppError(
      403,
      "ORDER_DECISION_DENIED",
      "Owner access or the Manager orders.confirm permission is required",
    );
  }

  return membership;
}

async function addOrderEvent(
  runner,
  orderId,
  actorId,
  type,
  priorStatus,
  newStatus,
  { reason = null, correlationId = null } = {},
) {
  await runner.query(
    `INSERT INTO app.order_events
      (order_id, actor_id, event_type, prior_status, new_status, reason, correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, actorId, type, priorStatus, newStatus, reason, correlationId],
  );
}

async function addAudit(
  runner,
  actorId,
  organizationId,
  action,
  type,
  id,
  reason = null,
) {
  await runner.query(
    `INSERT INTO app.audit_events
      (actor_id, organization_id, action, resource_type, resource_id, reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actorId, organizationId, action, type, id, reason],
  );
}

async function confirmReceipt(orderId, buyerId, reason, correlationId) {
  return db.transaction(async (runner) => {
    const order = await lockOrder(runner, orderId);

    // Only the actual buyer can confirm receipt.
    if (!sameId(order.buyer_id, buyerId)) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
    }

    // Repeated confirmation must not create duplicate events.
    if (order.fulfilment_status === "completed") {
      return order;
    }

    // Validate both transitions.
    assertTransition("dispatched", "delivered");
    assertTransition("delivered", "completed");

    // The order must have been dispatched.
    if (order.fulfilment_status !== "dispatched") {
      assertTransition(order.fulfilment_status, "delivered");
    }

    const result = await runner.query(
      `UPDATE app.orders
       SET fulfilment_status = 'completed',
           completed_at = now()
       WHERE id = $1
       RETURNING *`,
      [order.id],
    );

    // Create the passport snapshot within the same transaction.
    await createSnapshotForOrder(runner, order.id);

    await runner.query(
      `INSERT INTO app.impact_events
     (order_id, quantity, unit, impact_entry_type)
     VALUES ($1, $2, $3, 'diversion')
     ON CONFLICT (order_id) WHERE impact_entry_type = 'diversion'
     DO NOTHING`,
      [order.id, order.quantity, order.unit],
    );

    // Record dispatched -> delivered.
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "fulfilment.delivered",
      "dispatched",
      "delivered",
      { reason, correlationId },
    );

    // Record delivered -> completed.
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "fulfilment.completed",
      "delivered",
      "completed",
      { reason, correlationId },
    );

    await addAudit(
      runner,
      buyerId,
      order.organization_id,
      "order.fulfilment.completed",
      "order",
      order.id,
      reason,
    );

    return result.rows[0];
  });
}

async function cancelOrder(
  orderId,
  actorId,
  reason,
  correlationId,
  actorType,
  organizationId = null,
) {
  return db.transaction(async (runner) => {
    // Lock the order so simultaneous requests cannot cancel it twice.
    const order = await lockOrder(runner, orderId, organizationId);

    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
    }

    // Verify that the person requesting cancellation is authorized.
    if (actorType === "buyer") {
      if (!sameId(order.buyer_id, actorId)) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
      }
    } else if (actorType === "seller") {
      if (!sameId(order.organization_id, organizationId)) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
      }

      await requireOrderDecision(runner, actorId, organizationId);
    } else {
      throw new AppError(
        403,
        "ORDER_FORBIDDEN",
        "You are not authorized to cancel this order",
      );
    }

    // Repeated cancellation must not create duplicate events.
    if (order.fulfilment_status === "cancelled") {
      return order;
    }

    if (order.fulfilment_status === "disputed") {
      throw new AppError(
        409,
        "ORDER_DISPUTED",
        "Disputed orders must be resolved before cancellation",
      );
    }

    // The state machine prevents cancellation after dispatch.
    assertTransition(order.fulfilment_status, "cancelled");

    // Release reserved inventory within this same transaction.
    // await releaseReservation(
    //   runner,
    //   order.id,
    //   reason || "Order cancelled",
    // );

    await runner.query(
      `UPDATE app.inventory_reservations
      SET status = 'released',
      released_at = now(),
      release_reason = 'order_cancelled'
      WHERE order_id = $1
      AND status IN ('active', 'committed')`,
      [order.id],
    );

    const result = await runner.query(
      `UPDATE app.orders
       SET fulfilment_status = 'cancelled'
       WHERE id = $1
       RETURNING *`,
      [order.id],
    );

    // Record the state transition.
    await addOrderEvent(
      runner,
      order.id,
      actorId,
      "fulfilment.cancelled",
      order.fulfilment_status,
      "cancelled",
      { reason: reason || "Order cancelled", correlationId: correlationId },
    );

    // Record the action in the audit log.
    await addAudit(
      runner,
      actorId,
      order.organization_id,
      "order.fulfilment.cancelled",
      "order",
      order.id,
      reason || "Order cancelled",
    );

    return result.rows[0];
  });
}

async function raiseDispute(
  orderId,
  actorId,
  reason,
  correlationId,
  actorType,
  organizationId = null,
) {
  return db.transaction(async (runner) => {
    const order = await lockOrder(runner, orderId, organizationId);

    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    if (actorType === "buyer") {
      if (!sameId(order.buyer_id, actorId)) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
      }
    } else if (actorType === "seller") {
      await requireOrderDecision(runner, actorId, order.organization_id);
    } else {
      throw new AppError(
        403,
        "ORDER_ACCESS_DENIED",
        "You are not allowed to dispute this order",
      );
    }

    if (order.fulfilment_status === "disputed") {
      return order;
    }

    assertTransition(order.fulfilment_status, "disputed");

    //new addition

    await runner.query(
      `INSERT INTO app.disputes (
      order_id,
      raised_by,
      description,
      status
      )
      VALUES ($1, $2, $3, $4)`,
      [order.id, actorId, reason, "open"],
    );

    const result = await runner.query(
      `UPDATE app.orders
       SET fulfilment_status = 'disputed'
       WHERE id = $1
       RETURNING *`,
      [order.id],
    );

    await addOrderEvent(
      runner,
      order.id,
      actorId,
      "order.disputed",
      order.fulfilment_status,
      "disputed",
      { reason, correlationId },
    );

    await addAudit(
      runner,
      actorId,
      order.organization_id,
      "order.disputed",
      "order",
      order.id,
      reason,
    );

    return result.rows[0];
  });
}

async function simulateRefund(orderId, actorId, reason, correlationId) {
  return db.transaction(async (runner) => {
    const order = await lockOrder(runner, orderId);

    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    // Only an active, verified platform admin can simulate refunds.
    await requirePlatformAdmin(actorId, runner);

    // Repeated refund requests must not create duplicate records.
    if (order.fulfilment_status === "refunded") {
      return order;
    }

    assertTransition(order.fulfilment_status, "refunded");

    // Find the successful payment associated with this order.
    const paymentResult = await runner.query(
      `SELECT *
       FROM app.payment_attempts
       WHERE order_id = $1
         AND status = 'succeeded'
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [order.id],
    );

    if (!paymentResult.rowCount) {
      throw new AppError(
        409,
        "PAYMENT_NOT_REFUNDABLE",
        "No successful payment attempt is available to refund",
      );
    }

    const payment = paymentResult.rows[0];

    // Simulate the refund locally. No payment provider is contacted.
    await runner.query(
      `UPDATE app.payment_attempts
       SET status = 'refunded',
           updated_at = now()
       WHERE id = $1`,
      [payment.id],
    );

    const result = await runner.query(
      `UPDATE app.orders
       SET fulfilment_status = 'refunded'
       WHERE id = $1
       RETURNING *`,
      [order.id],
    );

    await runner.query(
      `INSERT INTO app.impact_events
      (order_id, quantity, unit, impact_entry_type)
      SELECT d.order_id, d.quantity, d.unit, 'reversal'
      FROM app.impact_events d
      WHERE d.order_id = $1
      AND d.impact_entry_type = 'diversion'
      AND NOT EXISTS (
      SELECT 1
      FROM app.impact_events r
      WHERE r.order_id = d.order_id
      AND r.impact_entry_type = 'reversal'
      )`,
      [orderId],
    );

    await addOrderEvent(
      runner,
      order.id,
      actorId,
      "order.refunded",
      order.fulfilment_status,
      "refunded",
      { reason, correlationId },
    );

    await addAudit(
      runner,
      actorId,
      order.organization_id,
      "order.refunded",
      "order",
      order.id,
      reason,
    );

    return result.rows[0];
  });
}

module.exports = {
  transitionOrder,
  confirmReceipt,
  cancelOrder,
  raiseDispute,
  simulateRefund,
};
