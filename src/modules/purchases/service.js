const { AppError } = require("../../lib/errors");
const db = require("../../db");
const { scaled } = require("../catalog/validation");
const { deliverEmail } = require("../../email/deliveryService");
const { purchaseGroupChoiceEmail } = require("../../email/templates");
const { env } = require("../../config/env");

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

function sameQuantitySet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => right.some((other) => quantitiesEqual(value, other)))
  );
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

function assertSameOrderRequest(
  existing,
  listingId,
  groupId,
  quantity,
  fulfilmentPriority = "standard",
) {
  if (
    !sameId(existing.listing_id, listingId) ||
    (existing.group_id === null
      ? groupId !== null
      : !sameId(existing.group_id, groupId)) ||
    !quantitiesEqual(existing.quantity, quantity) ||
    (existing.fulfilment_priority || "standard") !== fulfilmentPriority
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
  const fulfilmentPriority = input.fulfilmentPriority || "standard";
  return db.transaction(async (runner) => {
    const duplicate = await findRequestOrder(runner, buyerId, input.requestKey);
    if (duplicate) {
      assertSameOrderRequest(
        duplicate,
        input.listingId,
        null,
        input.quantity,
        fulfilmentPriority,
      );
      return duplicate;
    }

    const listing = await lockListing(runner, input.listingId);
    activeListing(listing);
    if (
      fulfilmentPriority === "standard" &&
      !["direct", "both"].includes(listing.purchase_mode)
    )
      throw new AppError(
        409,
        "DIRECT_PURCHASE_DISABLED",
        "This listing is not available for direct purchase",
      );
    if (
      fulfilmentPriority === "expedited" &&
      !listing.expedited_price_per_unit_minor
    )
      throw new AppError(
        409,
        "EXPEDITED_PURCHASE_UNAVAILABLE",
        "This listing does not offer urgent fulfillment",
      );

    const available = await availableQuantity(runner, listing);
    if (scaled(input.quantity, 3) > scaled(available, 3))
      throw new AppError(409, "INSUFFICIENT_STOCK", "Not enough stock remains");
    const minimumOrder =
      fulfilmentPriority === "expedited"
        ? listing.expedited_min_order_quantity || listing.min_order_quantity
        : listing.min_order_quantity;
    if (
      scaled(input.quantity, 3) < scaled(minimumOrder, 3) &&
      !quantitiesEqual(input.quantity, available)
    )
      throw new AppError(
        400,
        "MINIMUM_ORDER_NOT_MET",
        `Quantity must meet the minimum of ${minimumOrder} ${listing.unit} or purchase all remaining stock`,
      );

    const price =
      fulfilmentPriority === "expedited"
        ? {
            tierMinimum: minimumOrder,
            unitPriceMinor: listing.expedited_price_per_unit_minor.toString(),
          }
        : await snapshotPrice(runner, listing, input.quantity);
    const total = totalMinor(input.quantity, price.unitPriceMinor);
    const inserted = await runner.query(
      `INSERT INTO app.orders(
         buyer_id,listing_id,organization_id,request_key,quantity,unit,
         listing_version,price_tier_min_quantity,unit_price_minor,total_minor,
         fulfilment_priority,fulfilment_lead_time_days,status,seller_response_due_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_seller_confirmation',now()+INTERVAL '48 hours')
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
        fulfilmentPriority,
        fulfilmentPriority === "expedited"
          ? listing.expedited_lead_time_days
          : null,
      ],
    );
    if (!inserted.rowCount) {
      const raced = await findRequestOrder(runner, buyerId, input.requestKey);
      assertSameOrderRequest(
        raced,
        input.listingId,
        null,
        input.quantity,
        fulfilmentPriority,
      );
      return raced;
    }
    const order = inserted.rows[0];
    await addReservation(runner, order);
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      fulfilmentPriority === "expedited"
        ? "direct_order.expedited_placed"
        : "direct_order.placed",
      null,
      order.status,
      null,
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      listing.organization_id,
      fulfilmentPriority === "expedited"
        ? "purchase.expedited_order_placed"
        : "purchase.direct_order_placed",
      "order",
      order.id,
    );
    return order;
  });
}

// Buyers define the total quantity the group needs and a short menu of share
// sizes. A share equal to the exact remaining quantity is also valid.
async function createBuyerGroup(buyerId, input) {
  return db.transaction(async (runner) => {
    const listing = await lockListing(runner, input.listingId);
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
    if (scaled(input.targetQuantity, 3) < scaled(listing.min_order_quantity, 3))
      throw new AppError(
        400,
        "GROUP_TARGET_BELOW_MOQ",
        "The group target must meet the listing MOQ",
      );
    if (
      scaled(input.targetQuantity, 3) >
      scaled(await availableQuantity(runner, listing), 3)
    )
      throw new AppError(
        409,
        "INSUFFICIENT_STOCK",
        "The group target exceeds currently available stock",
      );
    if (input.shareOptions.length < 3 || input.shareOptions.length > 4)
      throw new AppError(
        400,
        "INVALID_SHARE_OPTIONS",
        "Choose three or four share sizes",
      );
    const unique = [
      ...new Set(
        input.shareOptions.map((value) => decimalFromScaled(scaled(value, 3))),
      ),
    ];
    if (
      unique.length !== input.shareOptions.length ||
      unique.some((value) => scaled(value, 3) > scaled(input.targetQuantity, 3))
    )
      throw new AppError(
        400,
        "INVALID_SHARE_OPTIONS",
        "Share sizes must be unique and no larger than the group target",
      );
    const duplicate = await runner.query(
      "SELECT * FROM app.purchase_groups WHERE organization_id=$1 AND request_key=$2",
      [listing.organization_id, input.requestKey],
    );
    if (duplicate.rowCount) {
      const group = duplicate.rows[0];
      const savedOptions = await runner.query(
        "SELECT quantity::text FROM app.purchase_group_share_options WHERE group_id=$1",
        [group.id],
      );
      if (
        !sameId(group.listing_id, listing.id) ||
        !quantitiesEqual(group.target_quantity, input.targetQuantity) ||
        new Date(group.closes_at).getTime() !== closesAt.getTime() ||
        !sameQuantitySet(
          savedOptions.rows.map((row) => row.quantity),
          unique,
        )
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This request key was already used for another group",
        );
      return group;
    }
    const inserted = await runner.query(
      `INSERT INTO app.purchase_groups(listing_id,organization_id,created_by,request_key,target_quantity,unit,closes_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id,request_key) WHERE request_key IS NOT NULL
       DO NOTHING RETURNING *`,
      [
        listing.id,
        listing.organization_id,
        buyerId,
        input.requestKey,
        input.targetQuantity,
        listing.unit,
        closesAt,
      ],
    );
    if (!inserted.rowCount) {
      const raced = await runner.query(
        "SELECT * FROM app.purchase_groups WHERE organization_id=$1 AND request_key=$2",
        [listing.organization_id, input.requestKey],
      );
      const existing = raced.rows[0];
      const savedOptions = existing
        ? await runner.query(
            "SELECT quantity::text FROM app.purchase_group_share_options WHERE group_id=$1",
            [existing.id],
          )
        : { rows: [] };
      if (
        !existing ||
        !sameId(existing.listing_id, listing.id) ||
        !quantitiesEqual(existing.target_quantity, input.targetQuantity) ||
        new Date(existing.closes_at).getTime() !== closesAt.getTime() ||
        !sameQuantitySet(
          savedOptions.rows.map((row) => row.quantity),
          unique,
        )
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This request key was already used for another group",
        );
      return existing;
    }
    const group = inserted.rows[0];
    await runner.query(
      `INSERT INTO app.purchase_group_share_options(group_id,quantity)
       SELECT $1, unnest($2::numeric[])`,
      [group.id, unique],
    );
    await addAudit(
      runner,
      buyerId,
      listing.organization_id,
      "purchase.buyer_group_created",
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
    if (group.status !== "open")
      throw new AppError(
        409,
        "GROUP_NOT_OPEN",
        "This group is not accepting contributions",
      );
    if (new Date(group.closes_at) <= new Date())
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
    const options = await runner.query(
      "SELECT quantity::text FROM app.purchase_group_share_options WHERE group_id=$1",
      [group.id],
    );
    const validShare =
      options.rowCount === 0 ||
      options.rows.some((row) =>
        quantitiesEqual(row.quantity, input.quantity),
      ) ||
      quantitiesEqual(
        input.quantity,
        quantitiesSubtract(group.target_quantity, active.rows[0].quantity),
      );
    if (!validShare)
      throw new AppError(
        400,
        "INVALID_GROUP_SHARE",
        "Choose one of the listed share sizes or the exact remaining quantity",
      );
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
    let nextStatus = "open";
    if (scaled(afterJoin, 3) >= scaled(group.target_quantity, 3)) {
      nextStatus = "ready_for_confirmation";
      await runner.query(
        "UPDATE app.purchase_groups SET seller_response_due_at=now()+INTERVAL '48 hours' WHERE id=$1",
        [groupId],
      );
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
      ![
        "open",
        "ready_for_confirmation",
        "reconfirmation_required",
        "deadline_choices",
      ].includes(group.status) ||
      order.status !== "group_open"
    )
      throw new AppError(
        409,
        "GROUP_WITHDRAWAL_CLOSED",
        "This contribution can no longer be withdrawn",
      );
    if (
      group.status === "deadline_choices" &&
      group.choice_deadline_at &&
      new Date(group.choice_deadline_at) <= new Date()
    )
      throw new AppError(
        409,
        "GROUP_CHOICES_CLOSED",
        "The group choice period has ended",
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
    if (
      group.status === "ready_for_confirmation" &&
      scaled(active.rows[0].quantity, 3) < scaled(group.target_quantity, 3)
    )
      nextStatus = "open";
    if (
      group.status === "deadline_choices" &&
      scaled(active.rows[0].quantity, 3) === 0n
    )
      nextStatus = "expired";
    if (
      group.status === "reconfirmation_required" &&
      scaled(active.rows[0].quantity, 3) >= scaled(group.target_quantity, 3)
    )
      nextStatus = "ready_for_confirmation";
    if (nextStatus !== group.status)
      await runner.query(
        "UPDATE app.purchase_groups SET status=$2,seller_response_due_at=CASE WHEN $2='ready_for_confirmation' THEN now()+INTERVAL '48 hours' ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1",
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
         seller_confirmed_at=now(),payment_due_at=now()+INTERVAL '48 hours'
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
      !["ready_for_confirmation", "reconfirmation_required"].includes(
        group.status,
      )
    )
      throw new AppError(
        409,
        "GROUP_DECISION_CLOSED",
        "This group cannot be decided in its current state",
      );
    if (
      group.seller_response_due_at &&
      new Date(group.seller_response_due_at) <= new Date()
    ) {
      const members = await runner.query(
        "SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE",
        [groupId],
      );
      for (const member of members.rows) {
        await releaseReservation(runner, member.id, "seller_timeout");
        await runner.query(
          "UPDATE app.orders SET status='seller_expired' WHERE id=$1",
          [member.id],
        );
        await addOrderEvent(
          runner,
          member.id,
          null,
          "group.seller_timeout",
          "group_open",
          "seller_expired",
          null,
          correlationId,
        );
      }
      await runner.query(
        "UPDATE app.purchase_groups SET status='expired',seller_response_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
        [groupId],
      );
      return { id: groupId, status: "expired", expired: true };
    }
    const current = await runner.query(
      `SELECT COALESCE(sum(quantity),0)::text AS quantity
       FROM app.orders WHERE group_id=$1 AND status = ANY($2::text[])`,
      [groupId, BUYER_ACTIVE_GROUP_STATUSES],
    );
    const quantity = current.rows[0].quantity;
    const reachedTarget =
      scaled(quantity, 3) >= scaled(group.target_quantity, 3);
    if (!scaled(quantity, 3))
      throw new AppError(
        409,
        "GROUP_EMPTY",
        "A group without contributions cannot be confirmed",
      );

    if (decision === "reject") {
      const members = await runner.query(
        `SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE`,
        [groupId],
      );
      for (const member of members.rows) {
        await releaseReservation(runner, member.id, "seller_rejected");
        await runner.query(
          "UPDATE app.orders SET status='rejected' WHERE id=$1",
          [member.id],
        );
        await addOrderEvent(
          runner,
          member.id,
          userId,
          "group.rejected",
          member.status,
          "rejected",
          reason,
          correlationId,
        );
      }
      await runner.query(
        `UPDATE app.purchase_groups SET status='rejected',version=version+1,updated_at=now() WHERE id=$1`,
        [groupId],
      );
      await addAudit(
        runner,
        userId,
        organizationId,
        "purchase.group_rejected",
        "purchase_group",
        groupId,
        reason,
      );
      return { id: groupId, status: "rejected", confirmedQuantity: null };
    }

    if (decision !== "confirm")
      throw new AppError(
        400,
        "INVALID_GROUP_DECISION",
        "Choose confirm or reject",
      );
    if (!reachedTarget && group.status !== "reconfirmation_required")
      throw new AppError(
        409,
        "GROUP_TARGET_NOT_REACHED",
        "The group must reach its target before Seller confirmation",
      );
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
         seller_confirmed_at=now(),payment_due_at=now()+INTERVAL '48 hours'
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
       seller_response_due_at=NULL,
       version=version+1,updated_at=now() WHERE id=$1`,
      [groupId, quantity, userId],
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

async function extendGroup(buyerId, groupId, correlationId) {
  const result = await db.transaction(async (runner) => {
    const found = await runner.query(
      "SELECT listing_id FROM app.purchase_groups WHERE id=$1",
      [groupId],
    );
    if (!found.rowCount)
      throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
    await lockListing(runner, found.rows[0].listing_id);
    const group = await lockGroup(runner, groupId);
    if (
      group.status !== "deadline_choices" ||
      !group.choice_deadline_at ||
      new Date(group.choice_deadline_at) <= new Date() ||
      Number(group.extension_count) !== 0
    )
      throw new AppError(
        409,
        "GROUP_CANNOT_EXTEND",
        "This group has no extension available",
      );
    const mine = await runner.query(
      "SELECT id FROM app.orders WHERE group_id=$1 AND buyer_id=$2 AND status='group_open' LIMIT 1",
      [groupId, buyerId],
    );
    if (!mine.rowCount)
      throw new AppError(
        403,
        "GROUP_PARTICIPANT_REQUIRED",
        "Only a current participant can extend this group",
      );
    const changed = await runner.query(
      `UPDATE app.purchase_groups SET status='open',extension_count=1,closes_at=now()+INTERVAL '48 hours',choice_deadline_at=NULL,version=version+1,updated_at=now() WHERE id=$1 RETURNING closes_at`,
      [groupId],
    );
    await addOrderEvent(
      runner,
      mine.rows[0].id,
      buyerId,
      "group.extended",
      "deadline_choices",
      "open",
      "Buyer used the one-time 48-hour extension",
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      group.organization_id,
      "purchase.group_extended",
      "purchase_group",
      groupId,
    );
    return {
      id: groupId,
      status: "open",
      closesAt: changed.rows[0].closes_at,
      extensionCount: 1,
    };
  });
  try {
    await notifyGroupChoice(groupId);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "purchase_group_extension_email_failed",
        groupId,
        error: error.code || error.name,
      }),
    );
  }
  return result;
}

async function switchGroupShareToDirect(
  buyerId,
  groupId,
  orderId,
  requestKey,
  correlationId,
) {
  return db.transaction(async (runner) => {
    const found = await runner.query(
      "SELECT listing_id FROM app.purchase_groups WHERE id=$1",
      [groupId],
    );
    if (!found.rowCount)
      throw new AppError(404, "PURCHASE_GROUP_NOT_FOUND", "Group unavailable");
    const listing = await lockListing(runner, found.rows[0].listing_id);
    activeListing(listing);
    const group = await lockGroup(runner, groupId);
    const duplicate = await findRequestOrder(runner, buyerId, requestKey);
    if (duplicate) {
      assertSameOrderRequest(
        duplicate,
        listing.id,
        null,
        duplicate.quantity,
        "expedited",
      );
      return duplicate;
    }
    const choicesOpen =
      (group.status === "deadline_choices" &&
        group.choice_deadline_at &&
        new Date(group.choice_deadline_at) > new Date()) ||
      (group.status === "open" &&
        Number(group.extension_count) === 1 &&
        new Date(group.closes_at) > new Date());
    if (!choicesOpen)
      throw new AppError(
        409,
        "GROUP_CHOICES_CLOSED",
        "The direct-purchase choice period has ended",
      );
    if (!listing.expedited_price_per_unit_minor)
      throw new AppError(
        409,
        "EXPEDITED_PURCHASE_UNAVAILABLE",
        "This listing has no urgent direct-purchase option",
      );
    const order = await lockOrder(runner, orderId);
    if (
      !sameId(order.group_id, groupId) ||
      !sameId(order.buyer_id, buyerId) ||
      order.status !== "group_open"
    )
      throw new AppError(
        404,
        "GROUP_SHARE_NOT_AVAILABLE",
        "Your unpaid group share is unavailable",
      );
    const minimum =
      listing.expedited_min_order_quantity || listing.min_order_quantity;
    if (scaled(order.quantity, 3) < scaled(minimum, 3))
      throw new AppError(
        409,
        "URGENT_MINIMUM_NOT_MET",
        `Urgent orders require at least ${minimum} ${listing.unit}`,
      );
    await releaseReservation(runner, order.id, "buyer_switched_to_direct");
    await runner.query("UPDATE app.orders SET status='withdrawn' WHERE id=$1", [
      order.id,
    ]);
    const inserted = await runner.query(
      `INSERT INTO app.orders(buyer_id,listing_id,organization_id,request_key,quantity,unit,listing_version,price_tier_min_quantity,unit_price_minor,total_minor,fulfilment_priority,fulfilment_lead_time_days,status,seller_response_due_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'expedited',$11,'pending_seller_confirmation',now()+INTERVAL '48 hours') RETURNING *`,
      [
        buyerId,
        listing.id,
        listing.organization_id,
        requestKey,
        order.quantity,
        listing.unit,
        listing.version,
        minimum,
        listing.expedited_price_per_unit_minor,
        totalMinor(order.quantity, listing.expedited_price_per_unit_minor),
        listing.expedited_lead_time_days,
      ],
    );
    const directOrder = inserted.rows[0];
    await addReservation(runner, directOrder);
    await addOrderEvent(
      runner,
      order.id,
      buyerId,
      "group.share_switched_to_direct",
      "group_open",
      "withdrawn",
      null,
      correlationId,
    );
    await addOrderEvent(
      runner,
      directOrder.id,
      buyerId,
      "direct_order.expedited_from_group",
      null,
      directOrder.status,
      null,
      correlationId,
    );
    await addAudit(
      runner,
      buyerId,
      listing.organization_id,
      "purchase.group_share_switched_to_direct",
      "order",
      directOrder.id,
    );
    return directOrder;
  });
}

async function notifyGroupChoice(groupId) {
  const result = await db.query(
    `SELECT DISTINCT g.extension_count,COALESCE(g.choice_deadline_at,g.closes_at) AS choice_deadline_at,l.title AS listing_title,
       u.id AS user_id,u.email,u.full_name
     FROM app.purchase_groups g
     JOIN app.listings l ON l.id=g.listing_id
     JOIN app.orders o ON o.group_id=g.id AND o.status='group_open'
     JOIN app.users u ON u.id=o.buyer_id AND u.status='active'
     WHERE g.id=$1 AND (g.status='deadline_choices' OR (g.status='open' AND g.extension_count=1))`,
    [groupId],
  );
  const deadline = result.rows[0]?.choice_deadline_at;
  if (!deadline) return;
  const deadlineText = new Date(deadline).toISOString();
  const url = new URL("/buyer/my-purchases", env.APP_URL).toString();
  const canExtend = Number(result.rows[0].extension_count) === 0;
  const deliveries = await Promise.allSettled(
    result.rows.map((participant) =>
      deliverEmail({
        eventKey: `group-choice:${groupId}:${new Date(deadline).getTime()}:${participant.user_id}`,
        recipient: participant.email,
        template: "purchase_group_choice",
        message: purchaseGroupChoiceEmail({
          name: participant.full_name,
          listingTitle: participant.listing_title,
          deadline: deadlineText,
          url,
          canExtend,
        }),
      }),
    ),
  );
  const failed = deliveries.filter(
    (delivery) => delivery.status === "rejected",
  ).length;
  if (failed)
    console.warn(
      JSON.stringify({
        event: "purchase_group_choice_email_failed",
        groupId,
        failed,
      }),
    );
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
          `UPDATE app.purchase_groups SET status='reconfirmation_required',seller_response_due_at=now()+INTERVAL '48 hours',version=version+1,updated_at=now()
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
  const dueGroups = await db.query(
    `SELECT id,listing_id FROM app.purchase_groups
     WHERE (status='open' AND closes_at<=now())
        OR (status='deadline_choices' AND choice_deadline_at<=now())
        OR (status IN ('ready_for_confirmation','reconfirmation_required') AND seller_response_due_at<=now())
     ORDER BY COALESCE(choice_deadline_at,seller_response_due_at,closes_at),id LIMIT $1`,
    [limit],
  );
  result.groupChoicesOpened = 0;
  result.groupExpired = 0;
  result.groupSellerTimeout = 0;
  for (const candidate of dueGroups.rows) {
    const state = await db.transaction(async (runner) => {
      await lockListing(runner, candidate.listing_id);
      const group = await lockGroup(runner, candidate.id);
      if (group.status === "open" && new Date(group.closes_at) <= new Date()) {
        const active = await runner.query(
          "SELECT count(*)::int AS n FROM app.orders WHERE group_id=$1 AND status=ANY($2::text[])",
          [group.id, BUYER_ACTIVE_GROUP_STATUSES],
        );
        if (!active.rows[0].n) {
          await runner.query(
            "UPDATE app.purchase_groups SET status='expired',version=version+1,updated_at=now() WHERE id=$1",
            [group.id],
          );
          return "expired";
        }
        await runner.query(
          "UPDATE app.purchase_groups SET status='deadline_choices',choice_deadline_at=now()+INTERVAL '48 hours',version=version+1,updated_at=now() WHERE id=$1",
          [group.id],
        );
        await addAudit(
          runner,
          null,
          group.organization_id,
          "purchase.group_deadline_choices_opened",
          "purchase_group",
          group.id,
        );
        return "choices";
      }
      if (
        group.status === "deadline_choices" &&
        group.choice_deadline_at &&
        new Date(group.choice_deadline_at) <= new Date()
      ) {
        const members = await runner.query(
          "SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE",
          [group.id],
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
            null,
            "group.expired",
            "group_open",
            "group_expired",
            "Buyer choice period ended",
            null,
          );
        }
        await runner.query(
          "UPDATE app.purchase_groups SET status='expired',version=version+1,updated_at=now() WHERE id=$1",
          [group.id],
        );
        return "expired";
      }
      if (
        ["ready_for_confirmation", "reconfirmation_required"].includes(
          group.status,
        ) &&
        group.seller_response_due_at &&
        new Date(group.seller_response_due_at) <= new Date()
      ) {
        const members = await runner.query(
          "SELECT * FROM app.orders WHERE group_id=$1 AND status='group_open' FOR UPDATE",
          [group.id],
        );
        for (const member of members.rows) {
          await releaseReservation(runner, member.id, "seller_timeout");
          await runner.query(
            "UPDATE app.orders SET status='seller_expired' WHERE id=$1",
            [member.id],
          );
          await addOrderEvent(
            runner,
            member.id,
            null,
            "group.seller_timeout",
            "group_open",
            "seller_expired",
            null,
            null,
          );
        }
        await runner.query(
          "UPDATE app.purchase_groups SET status='expired',seller_response_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
          [group.id],
        );
        await addAudit(
          runner,
          null,
          group.organization_id,
          "purchase.group_seller_timeout",
          "purchase_group",
          group.id,
        );
        return "sellerTimeout";
      }
      return null;
    });
    if (state === "choices") {
      result.groupChoicesOpened += 1;
      try {
        await notifyGroupChoice(candidate.id);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "purchase_group_choice_email_failed",
            groupId: candidate.id,
            error: error.code || error.name,
          }),
        );
      }
    }
    if (state === "expired") result.groupExpired += 1;
    if (state === "sellerTimeout") result.groupSellerTimeout += 1;
  }
  return result;
}

async function buyerOrders(buyerId, page, limit) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT o.*,g.status AS group_status,g.extension_count AS group_extension_count,g.choice_deadline_at AS group_choice_deadline_at,g.closes_at AS group_closes_at,l.title AS listing_title,
       l.min_order_quantity,l.expedited_price_per_unit_minor,l.expedited_min_order_quantity,l.expedited_lead_time_days,
       (SELECT ps.id FROM app.passport_snapshots ps WHERE ps.order_id=o.id ORDER BY ps.version DESC LIMIT 1) AS passport_id
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
      `SELECT o.*,l.title AS listing_title,g.status AS group_status,
         (SELECT ps.id FROM app.passport_snapshots ps WHERE ps.order_id=o.id ORDER BY ps.version DESC LIMIT 1) AS passport_id
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
    `SELECT g.*, (SELECT json_agg(quantity::text ORDER BY quantity) FROM app.purchase_group_share_options WHERE group_id=g.id) AS share_options,
       COALESCE(sum(o.quantity) FILTER (WHERE o.status=ANY($2::text[])),0)::text AS joined_quantity,
       l.title AS listing_title,l.unit,o2.organization_name
     FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
     JOIN app.organizations o2 ON o2.id=g.organization_id
     LEFT JOIN app.orders o ON o.group_id=g.id
     WHERE g.listing_id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o2.status='active'
       AND g.status='open' AND g.closes_at>now()
     GROUP BY g.id,l.title,l.unit,o2.organization_name
     ORDER BY g.closes_at,g.id LIMIT $3 OFFSET $4`,
    [listingId, BUYER_ACTIVE_GROUP_STATUSES, limit, offset],
  );
  const count = await db.query(
    `SELECT count(*)::int AS total FROM app.purchase_groups g
     JOIN app.listings l ON l.id=g.listing_id JOIN app.organizations o ON o.id=g.organization_id
     WHERE g.listing_id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o.status='active'
       AND g.status='open' AND g.closes_at>now()`,
    [listingId],
  );
  return { items: result.rows, total: count.rows[0].total, page, limit };
}

async function organizationGroups(userId, organizationId, page, limit) {
  const offset = (page - 1) * limit;
  return db.transaction(async (runner) => {
    await requireSellerManager(runner, userId, organizationId);
    const result = await runner.query(
      `SELECT g.*,(SELECT json_agg(quantity::text ORDER BY quantity) FROM app.purchase_group_share_options WHERE group_id=g.id) AS share_options,l.title AS listing_title,
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
    `SELECT g.*,(SELECT json_agg(quantity::text ORDER BY quantity) FROM app.purchase_group_share_options WHERE group_id=g.id) AS share_options,l.title AS listing_title,l.unit,o.name AS organization_name,
       COALESCE(sum(orders.quantity) FILTER (WHERE orders.status=ANY($2::text[])),0)::text AS joined_quantity
     FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
     JOIN app.organizations o ON o.id=g.organization_id
     LEFT JOIN app.orders orders ON orders.group_id=g.id
     WHERE g.id=$1 AND l.status='published' AND l.purchase_mode IN ('group','both')
       AND o.status='active'
       AND ((g.status IN ('open','ready_for_confirmation') AND g.closes_at>now()) OR
         (g.status='deadline_choices' AND g.choice_deadline_at>now()) OR g.status='reconfirmation_required')
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
  createBuyerGroup,
  joinGroup,
  leaveGroup,
  sellerDecision,
  decideGroup,
  extendGroup,
  switchGroupShareToDirect,
  expireDueOrders,
  buyerOrders,
  sellerOrders,
  listOpenGroups,
  organizationGroups,
  buyerGroupDetail,
  releaseReservation,
};
