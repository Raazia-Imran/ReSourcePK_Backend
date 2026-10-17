const { AppError } = require("../../lib/errors");
const db = require("../../db");
const { scaled } = require("../catalog/validation");

const BUYER_ACTIVE_GROUP_STATUSES = ["group_open", "pending_payment", "paid"];
const ACTIVE_RESERVATIONS_SQL = `
  SELECT COALESCE(sum(quantity), 0)::text AS quantity
  FROM app.inventory_reservations
  WHERE listing_id = $1 AND status IN ('active', 'committed')`;

function totalMinor(quantity, unitPriceMinor) {
  const quantityMilli = scaled(quantity, 3);
  const priceMinor = BigInt(unitPriceMinor);
  const total = (quantityMilli * priceMinor + 500n) / 1000n;
  if (total <= 0n || total > 9223372036854775807n)
    throw new AppError(400, "ORDER_TOTAL_INVALID", "Order total is invalid");
  return total.toString();
}

function quantitiesEqual(left, right) {
  return scaled(left, 3) === scaled(right, 3);
}

function sameId(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function quantitiesAdd(left, right) {
  return decimalFromScaled(scaled(left, 3) + scaled(right, 3));
}

function quantitiesSubtract(left, right) {
  const result = scaled(left, 3) - scaled(right, 3);
  return decimalFromScaled(result > 0n ? result : 0n);
}

function decimalFromScaled(value) {
  const whole = value / 1000n;
  const fraction = String(value % 1000n).padStart(3, "0");
  return `${whole}.${fraction}`;
}

async function lockListing(runner, listingId) {
  const result = await runner.query(
    `SELECT l.*, o.status AS organization_status
     FROM app.listings l JOIN app.organizations o ON o.id=l.organization_id
     WHERE l.id=$1 FOR UPDATE OF l,o`,
    [listingId],
  );
  if (!result.rowCount)
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing unavailable");
  return result.rows[0];
}

async function availableQuantity(runner, listing) {
  const reserved = await runner.query(ACTIVE_RESERVATIONS_SQL, [listing.id]);
  return quantitiesSubtract(listing.quantity, reserved.rows[0].quantity);
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

async function requireSellerManager(runner, userId, organizationId) {
  const membership = await sellerMembership(runner, userId, organizationId);
  if (!membership || !["owner", "manager"].includes(membership.role))
    throw new AppError(
      403,
      "SELLER_ACCESS_DENIED",
      "Active Owner or Manager access is required",
    );
  return membership;
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
  )
    throw new AppError(
      403,
      "ORDER_DECISION_DENIED",
      "Owner access or the Manager orders.confirm permission is required",
    );
  return membership;
}

async function lockOrder(runner, orderId, organizationId = null) {
  const result = await runner.query(
    `SELECT * FROM app.orders WHERE id=$1
       AND ($2::uuid IS NULL OR organization_id=$2) FOR UPDATE`,
    [orderId, organizationId],
  );
  if (!result.rowCount)
    throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
  return result.rows[0];
}

async function lockGroup(runner, groupId) {
  const result = await runner.query(
    "SELECT * FROM app.purchase_groups WHERE id=$1 FOR UPDATE",
    [groupId],
  );
  if (!result.rowCount)
    throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
  return result.rows[0];
}

async function snapshotPrice(runner, listing, quantity) {
  const tier = await runner.query(
    `SELECT min_quantity::text, price_per_unit_minor::text
     FROM app.listing_price_tiers
     WHERE listing_id=$1 AND min_quantity <= $2::numeric
     ORDER BY min_quantity DESC LIMIT 1`,
    [listing.id, quantity],
  );
  if (tier.rowCount)
    return {
      tierMinimum: tier.rows[0].min_quantity,
      unitPriceMinor: tier.rows[0].price_per_unit_minor,
    };
  return {
    tierMinimum: listing.min_order_quantity,
    unitPriceMinor: listing.price_per_unit_minor.toString(),
  };
}

async function findRequestOrder(runner, buyerId, requestKey) {
  const result = await runner.query(
    "SELECT * FROM app.orders WHERE buyer_id=$1 AND request_key=$2",
    [buyerId, requestKey],
  );
  return result.rows[0] || null;
}

function assertSameOrderRequest(existing, listingId, groupId, quantity) {
  if (
    !sameId(existing.listing_id, listingId) ||
    (existing.group_id === null
      ? groupId !== null
      : !sameId(existing.group_id, groupId)) ||
    !quantitiesEqual(existing.quantity, quantity)
  )
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This request key was already used for a different purchase",
    );
}

async function addOrderEvent(
  runner,
  orderId,
  actorId,
  type,
  priorStatus,
  newStatus,
  reason = null,
  correlationId = null,
) {
  await runner.query(
    `INSERT INTO app.order_events(order_id,actor_id,event_type,prior_status,new_status,reason,correlation_id)
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
    `INSERT INTO app.audit_events(actor_id,organization_id,action,resource_type,resource_id,reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actorId, organizationId, action, type, id, reason],
  );
}

async function addReservation(runner, order) {
  await runner.query(
    `INSERT INTO app.inventory_reservations(order_id,listing_id,quantity)
     VALUES($1,$2,$3)`,
    [order.id, order.listing_id, order.quantity],
  );
}

async function releaseReservation(runner, orderId, reason) {
  const result = await runner.query(
    `UPDATE app.inventory_reservations
     SET status='released',released_at=now(),release_reason=$2
     WHERE order_id=$1 AND status='active' RETURNING id`,
    [orderId, reason],
  );
  if (!result.rowCount)
    throw new AppError(
      409,
      "RESERVATION_NOT_ACTIVE",
      "The order has no active inventory reservation",
    );
}

function activeListing(listing) {
  if (
    listing.status !== "published" ||
    listing.organization_status !== "active"
  )
    throw new AppError(
      409,
      "LISTING_UNAVAILABLE",
      "This listing is not available for purchase",
    );
}

async function createDirectOrder(buyerId, input, correlationId) {
  return db.transaction(async (runner) => {
    const duplicate = await findRequestOrder(runner, buyerId, input.requestKey);
    if (duplicate) {
      assertSameOrderRequest(duplicate, input.listingId, null, input.quantity);
      return duplicate;
    }

    const listing = await lockListing(runner, input.listingId);
    activeListing(listing);
    if (!["direct", "both"].includes(listing.purchase_mode))
      throw new AppError(
        409,
        "DIRECT_PURCHASE_DISABLED",
        "This listing is not available for direct purchase",
      );

    const available = await availableQuantity(runner, listing);
    if (scaled(input.quantity, 3) > scaled(available, 3))
      throw new AppError(409, "INSUFFICIENT_STOCK", "Not enough stock remains");
    if (
      scaled(input.quantity, 3) < scaled(listing.min_order_quantity, 3) &&
      !quantitiesEqual(input.quantity, available)
    )
      throw new AppError(
        400,
        "MINIMUM_ORDER_NOT_MET",
        "Quantity must meet the listing minimum or purchase all remaining stock",
      );

    const price = await snapshotPrice(runner, listing, input.quantity);
    const total = totalMinor(input.quantity, price.unitPriceMinor);
    const inserted = await runner.query(
      `INSERT INTO app.orders(
         buyer_id,listing_id,organization_id,request_key,quantity,unit,
         listing_version,price_tier_min_quantity,unit_price_minor,total_minor,
         status,seller_response_due_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_seller_confirmation',now()+INTERVAL '72 hours')
       ON CONFLICT (buyer_id,request_key) DO NOTHING RETURNING *`,
      [
        buyerId,
        listing.id,
        listing.organization_id,
        input.requestKey,
        input.quantity,
        listing.unit,
        listing.version,
        price.tierMinimum,
        price.unitPriceMinor,
        total,
      ],
    );
    if (!inserted.rowCount) {
      const raced = await findRequestOrder(runner, buyerId, input.requestKey);
      assertSameOrderRequest(raced, input.listingId, null, input.quantity);
      return raced;
    }
    const order = inserted.rows[0];
    await addReservation(runner, order);
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "direct_order.placed",
      null,
      order.status,
      null,
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      listing.organization_id,
      "purchase.direct_order_placed",
      "order",
      order.id,
    );
    return order;
  });
}

async function createGroup(actorId, organizationId, input) {
  return db.transaction(async (runner) => {
    await requireSellerManager(runner, actorId, organizationId);
    const duplicate = await runner.query(
      `SELECT * FROM app.purchase_groups WHERE organization_id=$1 AND request_key=$2`,
      [organizationId, input.requestKey],
    );
    if (duplicate.rowCount) {
      const existing = duplicate.rows[0];
      if (
        !sameId(existing.listing_id, input.listingId) ||
        !quantitiesEqual(existing.target_quantity, input.targetQuantity) ||
        new Date(existing.closes_at).getTime() !==
          new Date(input.closesAt).getTime()
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This request key was already used for a different group",
        );
      return existing;
    }
    const listing = await lockListing(runner, input.listingId);
    if (listing.organization_id !== organizationId)
      throw new AppError(404, "LISTING_NOT_FOUND", "Listing unavailable");
    activeListing(listing);
    if (!["group", "both"].includes(listing.purchase_mode))
      throw new AppError(
        409,
        "GROUP_ORDERING_DISABLED",
        "Group ordering is not enabled for this listing",
      );
    const closesAt = new Date(input.closesAt);
    if (!Number.isFinite(closesAt.getTime()) || closesAt <= new Date())
      throw new AppError(
        400,
        "INVALID_GROUP_DEADLINE",
        "Deadline must be in the future",
      );
    const available = await availableQuantity(runner, listing);
    if (scaled(input.targetQuantity, 3) > scaled(available, 3))
      throw new AppError(
        409,
        "INSUFFICIENT_STOCK",
        "The group target exceeds currently available stock",
      );
    const result = await runner.query(
      `INSERT INTO app.purchase_groups(
         listing_id,organization_id,created_by,request_key,target_quantity,unit,closes_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id,request_key) WHERE request_key IS NOT NULL
       DO NOTHING RETURNING *`,
      [
        listing.id,
        organizationId,
        actorId,
        input.requestKey,
        input.targetQuantity,
        listing.unit,
        closesAt,
      ],
    );
    if (!result.rowCount) {
      const raced = await runner.query(
        "SELECT * FROM app.purchase_groups WHERE organization_id=$1 AND request_key=$2",
        [organizationId, input.requestKey],
      );
      const existing = raced.rows[0];
      if (
        !existing ||
        !sameId(existing.listing_id, input.listingId) ||
        !quantitiesEqual(existing.target_quantity, input.targetQuantity) ||
        new Date(existing.closes_at).getTime() !== closesAt.getTime()
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This request key was already used for a different group",
        );
      return existing;
    }
    const group = result.rows[0];
    await addAudit(
      runner,
      actorId,
      organizationId,
      "purchase.group_created",
      "purchase_group",
      group.id,
    );
    return group;
  });
}

async function joinGroup(buyerId, groupId, input, correlationId) {
  return db.transaction(async (runner) => {
    const found = await runner.query(
      "SELECT listing_id FROM app.purchase_groups WHERE id=$1",
      [groupId],
    );
    if (!found.rowCount)
      throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
    const listing = await lockListing(runner, found.rows[0].listing_id);
    activeListing(listing);
    if (!["group", "both"].includes(listing.purchase_mode))
      throw new AppError(
        409,
        "GROUP_ORDERING_DISABLED",
        "This listing no longer accepts group contributions",
      );
    const group = await lockGroup(runner, groupId);
    const duplicate = await findRequestOrder(runner, buyerId, input.requestKey);
    if (duplicate) {
      assertSameOrderRequest(duplicate, listing.id, group.id, input.quantity);
      return duplicate;
    }
    if (
      !["open", "ready_for_confirmation", "reconfirmation_required"].includes(
        group.status,
      )
    )
      throw new AppError(
        409,
        "GROUP_NOT_OPEN",
        "This group is not accepting contributions",
      );
    if (
      group.status !== "reconfirmation_required" &&
      new Date(group.closes_at) <= new Date()
    )
      throw new AppError(
        409,
        "GROUP_DEADLINE_PASSED",
        "The group deadline has passed",
      );

    const currentShare = await runner.query(
      `SELECT id FROM app.orders WHERE group_id=$1 AND buyer_id=$2
       AND status=ANY($3::text[]) LIMIT 1`,
      [groupId, buyerId, BUYER_ACTIVE_GROUP_STATUSES],
    );
    if (currentShare.rowCount)
      throw new AppError(
        409,
        "BUYER_ALREADY_IN_GROUP",
        "You already have an active share in this group",
      );

    const active = await runner.query(
      `SELECT COALESCE(sum(quantity),0)::text AS quantity
       FROM app.orders WHERE group_id=$1 AND status = ANY($2::text[])`,
      [groupId, BUYER_ACTIVE_GROUP_STATUSES],
    );
    const afterJoin = quantitiesAdd(active.rows[0].quantity, input.quantity);
    if (scaled(afterJoin, 3) > scaled(group.target_quantity, 3))
      throw new AppError(
        409,
        "GROUP_TARGET_EXCEEDED",
        "Contribution exceeds remaining group quantity",
      );
    const available = await availableQuantity(runner, listing);
    if (scaled(input.quantity, 3) > scaled(available, 3))
      throw new AppError(409, "INSUFFICIENT_STOCK", "Not enough stock remains");

    const price = await snapshotPrice(runner, listing, input.quantity);
    const total = totalMinor(input.quantity, price.unitPriceMinor);
    const inserted = await runner.query(
      `INSERT INTO app.orders(
         buyer_id,listing_id,organization_id,group_id,request_key,quantity,unit,
         listing_version,price_tier_min_quantity,unit_price_minor,total_minor,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'group_open')
       ON CONFLICT (buyer_id,request_key) DO NOTHING RETURNING *`,
      [
        buyerId,
        listing.id,
        listing.organization_id,
        groupId,
        input.requestKey,
        input.quantity,
        listing.unit,
        listing.version,
        price.tierMinimum,
        price.unitPriceMinor,
        total,
      ],
    );
    if (!inserted.rowCount) {
      const raced = await findRequestOrder(runner, buyerId, input.requestKey);
      assertSameOrderRequest(raced, listing.id, group.id, input.quantity);
      return raced;
    }
    const order = inserted.rows[0];
    await addReservation(runner, order);
    let nextStatus =
      group.status === "reconfirmation_required"
        ? "reconfirmation_required"
        : "open";
    if (quantitiesEqual(afterJoin, group.target_quantity))
      nextStatus = "ready_for_confirmation";
    if (nextStatus !== group.status)
      await runner.query(
        "UPDATE app.purchase_groups SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
        [groupId, nextStatus],
      );
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "group.contribution_joined",
      null,
      order.status,
      null,
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      listing.organization_id,
      "purchase.group_contribution_joined",
      "order",
      order.id,
    );
    return order;
  });
}

async function leaveGroup(buyerId, groupId, orderId, correlationId) {
  return db.transaction(async (runner) => {
    const found = await runner.query(
      "SELECT listing_id FROM app.purchase_groups WHERE id=$1",
      [groupId],
    );
    if (!found.rowCount)
      throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
    await lockListing(runner, found.rows[0].listing_id);
    const group = await lockGroup(runner, groupId);
    const order = await lockOrder(runner, orderId);
    if (!sameId(order.group_id, groupId) || !sameId(order.buyer_id, buyerId))
      throw new AppError(
        404,
        "ORDER_NOT_FOUND",
        "Group contribution unavailable",
      );
    if (
      !["open", "ready_for_confirmation", "reconfirmation_required"].includes(
        group.status,
      ) ||
      order.status !== "group_open"
    )
      throw new AppError(
        409,
        "GROUP_WITHDRAWAL_CLOSED",
        "This contribution can no longer be withdrawn",
      );
    await releaseReservation(runner, order.id, "buyer_withdrew");
    const result = await runner.query(
      `UPDATE app.orders SET status='withdrawn' WHERE id=$1 RETURNING *`,
      [order.id],
    );
    const active = await runner.query(
      `SELECT COALESCE(sum(quantity),0)::text AS quantity
       FROM app.orders WHERE group_id=$1 AND status = ANY($2::text[])`,
      [groupId, BUYER_ACTIVE_GROUP_STATUSES],
    );
    let nextStatus = group.status;
    if (group.status !== "reconfirmation_required") {
      nextStatus =
        scaled(active.rows[0].quantity, 3) >=
          scaled(group.target_quantity, 3) ||
        new Date(group.closes_at) <= new Date()
          ? "ready_for_confirmation"
          : "open";
    } else if (
      scaled(active.rows[0].quantity, 3) >= scaled(group.target_quantity, 3)
    ) {
      nextStatus = "ready_for_confirmation";
    }
    if (nextStatus !== group.status)
      await runner.query(
        "UPDATE app.purchase_groups SET status=$2,version=version+1,updated_at=now() WHERE id=$1",
        [groupId, nextStatus],
      );
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "group.contribution_withdrawn",
      order.status,
      "withdrawn",
      "Buyer left before Seller confirmation",
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      order.organization_id,
      "purchase.group_contribution_withdrawn",
      "order",
      order.id,
    );
    return result.rows[0];
  });
}

async function sellerDecision(
  userId,
  organizationId,
  orderId,
  decision,
  reason,
  correlationId,
) {
  const preview = await db.query(
    "SELECT listing_id,group_id FROM app.orders WHERE id=$1 AND organization_id=$2",
    [orderId, organizationId],
  );
  if (!preview.rowCount)
    throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
  if (preview.rows[0].group_id)
    throw new AppError(
      409,
      "GROUP_ORDER_DECISION_REQUIRED",
      "Use the group decision endpoint",
    );
  return db.transaction(async (runner) => {
    await lockListing(runner, preview.rows[0].listing_id);
    await requireOrderDecision(runner, userId, organizationId);
    const order = await lockOrder(runner, orderId, organizationId);
    if (order.group_id || order.status !== "pending_seller_confirmation")
      throw new AppError(
        409,
        "ORDER_NOT_AWAITING_SELLER",
        "Order is not awaiting Seller confirmation",
      );
    if (new Date(order.seller_response_due_at) <= new Date()) {
      await releaseReservation(runner, order.id, "seller_timeout");
      const expired = await runner.query(
        "UPDATE app.orders SET status='seller_expired' WHERE id=$1 RETURNING *",
        [order.id],
      );
      await addOrderEvent(
        runner,
        order.id,
        null,
        "direct_order.seller_timeout",
        order.status,
        "seller_expired",
        null,
        correlationId,
      );
      await addAudit(
        runner,
        userId,
        organizationId,
        "purchase.direct_order_seller_timeout",
        "order",
        order.id,
      );
      return { order: expired.rows[0], expired: true };
    }
    if (decision === "reject") {
      await releaseReservation(runner, order.id, "seller_rejected");
      const rejected = await runner.query(
        "UPDATE app.orders SET status='rejected' WHERE id=$1 RETURNING *",
        [order.id],
      );
      await addOrderEvent(
        runner,
        order.id,
        userId,
        "direct_order.rejected",
        order.status,
        "rejected",
        reason,
        correlationId,
      );
      await addAudit(
        runner,
        userId,
        organizationId,
        "purchase.direct_order_rejected",
        "order",
        order.id,
        reason,
      );
      return { order: rejected.rows[0], expired: false };
    }
    const confirmed = await runner.query(
      `UPDATE app.orders SET status='pending_payment',seller_confirmed_by=$2,
         seller_confirmed_at=now(),payment_due_at=now()+INTERVAL '72 hours'
       WHERE id=$1 RETURNING *`,
      [order.id, userId],
    );
    await addOrderEvent(
      runner,
      order.id,
      userId,
      "direct_order.confirmed",
      order.status,
      "pending_payment",
      reason,
      correlationId,
    );
    await addAudit(
      runner,
      userId,
      organizationId,
      "purchase.direct_order_confirmed",
      "order",
      order.id,
      reason,
    );
    return { order: confirmed.rows[0], expired: false };
  });
}

async function decideGroup(
  userId,
  organizationId,
  groupId,
  decision,
  reason,
  correlationId,
) {
  const preview = await db.query(
    "SELECT listing_id FROM app.purchase_groups WHERE id=$1 AND organization_id=$2",
    [groupId, organizationId],
  );
  if (!preview.rowCount)
    throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
  return db.transaction(async (runner) => {
    await lockListing(runner, preview.rows[0].listing_id);
    await requireOrderDecision(runner, userId, organizationId);
    const group = await lockGroup(runner, groupId);
    if (group.organization_id !== organizationId)
      throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
    if (
      !["open", "ready_for_confirmation", "reconfirmation_required"].includes(
        group.status,
      )
    )
      throw new AppError(
        409,
        "GROUP_DECISION_CLOSED",
        "This group cannot be decided in its current state",
      );
    const current = await runner.query(
      `SELECT COALESCE(sum(quantity),0)::text AS quantity
       FROM app.orders WHERE group_id=$1 AND status = ANY($2::text[])`,
      [groupId, BUYER_ACTIVE_GROUP_STATUSES],
    );
    const quantity = current.rows[0].quantity;
    const reachedTarget =
      scaled(quantity, 3) >= scaled(group.target_quantity, 3);
    const deadlinePassed = new Date(group.closes_at) <= new Date();
    if (!scaled(quantity, 3))
      throw new AppError(
        409,
        "GROUP_EMPTY",
        "A group without contributions cannot be confirmed",
      );

    if (decision === "expire") {
      if (!deadlinePassed || reachedTarget)
        throw new AppError(
          409,
          "GROUP_EXPIRY_NOT_ALLOWED",
          "Only an under-target group at its deadline can be expired",
        );
      const members = await runner.query(
        `SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE`,
        [groupId],
      );
      for (const member of members.rows) {
        await releaseReservation(runner, member.id, "group_expired");
        await runner.query(
          "UPDATE app.orders SET status='group_expired' WHERE id=$1",
          [member.id],
        );
        await addOrderEvent(
          runner,
          member.id,
          userId,
          "group.expired",
          member.status,
          "group_expired",
          reason,
          correlationId,
        );
      }
      await runner.query(
        `UPDATE app.purchase_groups SET status='expired',deadline_decision='expire',
         deadline_decided_by=$2,deadline_decided_at=now(),version=version+1,updated_at=now()
         WHERE id=$1`,
        [groupId, userId],
      );
      await addAudit(
        runner,
        userId,
        organizationId,
        "purchase.group_expired",
        "purchase_group",
        groupId,
        reason,
      );
      return { id: groupId, status: "expired", confirmedQuantity: null };
    }

    if (decision !== "confirm")
      throw new AppError(
        400,
        "INVALID_GROUP_DECISION",
        "Choose confirm or expire",
      );
    if (!reachedTarget && !deadlinePassed)
      throw new AppError(
        409,
        "GROUP_TARGET_NOT_REACHED",
        "The group can be confirmed below target only after its deadline",
      );
    const decisionName = reachedTarget ? null : "confirm_smaller";
    const members = await runner.query(
      `SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE`,
      [groupId],
    );
    if (!members.rowCount)
      throw new AppError(
        409,
        "GROUP_NO_UNPAID_MEMBERS",
        "There are no unpaid shares to confirm",
      );
    for (const member of members.rows) {
      await runner.query(
        `UPDATE app.orders SET status='pending_payment',seller_confirmed_by=$2,
         seller_confirmed_at=now(),payment_due_at=now()+INTERVAL '72 hours'
         WHERE id=$1`,
        [member.id, userId],
      );
      await addOrderEvent(
        runner,
        member.id,
        userId,
        "group.confirmed",
        member.status,
        "pending_payment",
        reason,
        correlationId,
      );
    }
    await runner.query(
      `UPDATE app.purchase_groups SET status='payment_open',confirmed_quantity=$2,
       seller_confirmed_by=$3,seller_confirmed_at=now(),
       deadline_decision=COALESCE($4,deadline_decision),
       deadline_decided_by=CASE WHEN $4 IS NULL THEN deadline_decided_by ELSE $3 END,
       deadline_decided_at=CASE WHEN $4 IS NULL THEN deadline_decided_at ELSE now() END,
       version=version+1,updated_at=now() WHERE id=$1`,
      [groupId, quantity, userId, decisionName],
    );
    await addAudit(
      runner,
      userId,
      organizationId,
      "purchase.group_confirmed",
      "purchase_group",
      groupId,
      reason,
    );
    return { id: groupId, status: "payment_open", confirmedQuantity: quantity };
  });
}

async function expireDueOrders(limit = 100) {
  const candidates = await db.query(
    `SELECT id FROM app.orders
     WHERE (status='pending_seller_confirmation' AND seller_response_due_at<=now())
        OR (status='pending_payment' AND payment_due_at<=now())
     ORDER BY COALESCE(payment_due_at,seller_response_due_at),id LIMIT $1`,
    [limit],
  );
  const result = { sellerExpired: 0, paymentExpired: 0 };
  for (const candidate of candidates.rows) {
    const changed = await db.transaction(async (runner) => {
      const preview = await runner.query(
        "SELECT listing_id,group_id FROM app.orders WHERE id=$1",
        [candidate.id],
      );
      if (!preview.rowCount) return null;
      await lockListing(runner, preview.rows[0].listing_id);
      let group = null;
      if (preview.rows[0].group_id)
        group = await lockGroup(runner, preview.rows[0].group_id);
      const order = await lockOrder(runner, candidate.id);
      const timedOutSeller =
        order.status === "pending_seller_confirmation" &&
        new Date(order.seller_response_due_at) <= new Date();
      const timedOutPayment =
        order.status === "pending_payment" &&
        new Date(order.payment_due_at) <= new Date();
      if (!timedOutSeller && !timedOutPayment) return null;
      await releaseReservation(
        runner,
        order.id,
        timedOutSeller ? "seller_timeout" : "payment_timeout",
      );
      const nextStatus = timedOutSeller ? "seller_expired" : "payment_expired";
      await runner.query("UPDATE app.orders SET status=$2 WHERE id=$1", [
        order.id,
        nextStatus,
      ]);
      await addOrderEvent(
        runner,
        order.id,
        null,
        timedOutSeller
          ? "direct_order.seller_timeout"
          : "order.payment_timeout",
        order.status,
        nextStatus,
        null,
        null,
      );
      await addAudit(
        runner,
        null,
        order.organization_id,
        timedOutSeller
          ? "purchase.direct_order_seller_timeout"
          : "purchase.order_payment_timeout",
        "order",
        order.id,
      );
      if (timedOutPayment && group) {
        const reopened = await runner.query(
          `UPDATE app.orders SET status='group_open',seller_confirmed_by=NULL,
           seller_confirmed_at=NULL,payment_due_at=NULL
           WHERE group_id=$1 AND status='pending_payment' RETURNING id`,
          [group.id],
        );
        for (const reopenedOrder of reopened.rows) {
          await addOrderEvent(
            runner,
            reopenedOrder.id,
            null,
            "group.payment_window_reopened",
            "pending_payment",
            "group_open",
            "Seller reconfirmation required after a participant missed payment",
          );
        }
        await runner.query(
          `UPDATE app.purchase_groups SET status='reconfirmation_required',version=version+1,updated_at=now()
           WHERE id=$1 AND status='payment_open'`,
          [group.id],
        );
        await addAudit(
          runner,
          null,
          order.organization_id,
          "purchase.group_reconfirmation_required",
          "purchase_group",
          group.id,
          "A participant did not pay before the payment deadline",
        );
      }
      return timedOutSeller ? "seller" : "payment";
    });
    if (changed === "seller") result.sellerExpired += 1;
    if (changed === "payment") result.paymentExpired += 1;
  }
  return result;
}

async function buyerOrders(buyerId, page, limit) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT o.*,g.status AS group_status,l.title AS listing_title
     FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
     LEFT JOIN app.purchase_groups g ON g.id=o.group_id
     WHERE o.buyer_id=$1 ORDER BY o.created_at DESC,o.id DESC LIMIT $2 OFFSET $3`,
    [buyerId, limit, offset],
  );
  const count = await db.query(
    "SELECT count(*)::int AS total FROM app.orders WHERE buyer_id=$1",
    [buyerId],
  );
  return { items: result.rows, total: count.rows[0].total, page, limit };
}

async function sellerOrders(userId, organizationId, page, limit) {
  const offset = (page - 1) * limit;
  return db.transaction(async (runner) => {
    await requireOrderDecision(runner, userId, organizationId);
    const result = await runner.query(
      `SELECT o.*,l.title AS listing_title,g.status AS group_status
       FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       LEFT JOIN app.purchase_groups g ON g.id=o.group_id
       WHERE o.organization_id=$1 ORDER BY o.created_at DESC,o.id DESC LIMIT $2 OFFSET $3`,
      [organizationId, limit, offset],
    );
    const count = await runner.query(
      "SELECT count(*)::int AS total FROM app.orders WHERE organization_id=$1",
      [organizationId],
    );
    return { items: result.rows, total: count.rows[0].total, page, limit };
  });
}

async function listOpenGroups(listingId, page, limit) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT g.*, COALESCE(sum(o.quantity) FILTER (WHERE o.status=ANY($2::text[])),0)::text AS joined_quantity,
       l.title AS listing_title,l.unit,o2.organization_name
     FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
     JOIN app.organizations o2 ON o2.id=g.organization_id
     LEFT JOIN app.orders o ON o.group_id=g.id
     WHERE g.listing_id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o2.status='active'
       AND (g.status='reconfirmation_required' OR
         (g.status IN ('open','ready_for_confirmation') AND g.closes_at>now()))
     GROUP BY g.id,l.title,l.unit,o2.organization_name
     ORDER BY g.closes_at,g.id LIMIT $3 OFFSET $4`,
    [listingId, BUYER_ACTIVE_GROUP_STATUSES, limit, offset],
  );
  const count = await db.query(
    `SELECT count(*)::int AS total FROM app.purchase_groups g
     JOIN app.listings l ON l.id=g.listing_id JOIN app.organizations o ON o.id=g.organization_id
     WHERE g.listing_id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o.status='active'
       AND (g.status='reconfirmation_required' OR
         (g.status IN ('open','ready_for_confirmation') AND g.closes_at>now()))`,
    [listingId],
  );
  return { items: result.rows, total: count.rows[0].total, page, limit };
}

async function organizationGroups(userId, organizationId, page, limit) {
  const offset = (page - 1) * limit;
  return db.transaction(async (runner) => {
    await requireSellerManager(runner, userId, organizationId);
    const result = await runner.query(
      `SELECT g.*,l.title AS listing_title,
         COALESCE(sum(o.quantity) FILTER (WHERE o.status=ANY($2::text[])),0)::text AS joined_quantity
       FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
       LEFT JOIN app.orders o ON o.group_id=g.id
       WHERE g.organization_id=$1 GROUP BY g.id,l.title ORDER BY g.created_at DESC,g.id
       LIMIT $3 OFFSET $4`,
      [organizationId, BUYER_ACTIVE_GROUP_STATUSES, limit, offset],
    );
    const count = await runner.query(
      "SELECT count(*)::int AS total FROM app.purchase_groups WHERE organization_id=$1",
      [organizationId],
    );
    return { items: result.rows, total: count.rows[0].total, page, limit };
  });
}

async function buyerGroupDetail(buyerId, groupId) {
  const result = await db.query(
    `SELECT g.*,l.title AS listing_title,l.unit,o.name AS organization_name,
       COALESCE(sum(orders.quantity) FILTER (WHERE orders.status=ANY($2::text[])),0)::text AS joined_quantity
     FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
     JOIN app.organizations o ON o.id=g.organization_id
     LEFT JOIN app.orders orders ON orders.group_id=g.id
     WHERE g.id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o.status='active'
       AND (g.status='reconfirmation_required' OR
         (g.status IN ('open','ready_for_confirmation') AND g.closes_at>now()))
     GROUP BY g.id,l.title,l.unit,o.name`,
    [groupId, BUYER_ACTIVE_GROUP_STATUSES],
  );
  if (!result.rowCount)
    throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
  const mine = await db.query(
    `SELECT id,quantity,unit_price_minor,total_minor,status,created_at
     FROM app.orders WHERE group_id=$1 AND buyer_id=$2 ORDER BY created_at DESC`,
    [groupId, buyerId],
  );
  return { ...result.rows[0], myContributions: mine.rows };
}

module.exports = {
  createDirectOrder,
  createGroup,
  joinGroup,
  leaveGroup,
  sellerDecision,
  decideGroup,
  expireDueOrders,
  buyerOrders,
  sellerOrders,
  listOpenGroups,
  organizationGroups,
  buyerGroupDetail,
};
