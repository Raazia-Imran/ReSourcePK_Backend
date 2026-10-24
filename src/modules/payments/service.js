const crypto = require("node:crypto");
const { env } = require("../../config/env");
const db = require("../../db");
const { AppError } = require("../../lib/errors");
const { createHostedCheckout } = require("./rapidGateway");

const PROVIDER = "rapidgateway";
const CALLBACK_WINDOW_MS = 5 * 60 * 1000;

function safeEqualHex(left, right) {
  if (!/^[a-f\d]{64}$/i.test(left || "") || !/^[a-f\d]{64}$/i.test(right || ""))
    return false;
  return crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

function validTimestamp(value) {
  const numeric = Number(value);
  let milliseconds = Date.parse(value);
  if (Number.isFinite(numeric))
    milliseconds = numeric > 1e12 ? numeric : numeric * 1000;
  return (
    Number.isFinite(milliseconds) &&
    Math.abs(Date.now() - milliseconds) <= CALLBACK_WINDOW_MS
  );
}

function amountToMinor(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function verifyWebhook(headers, rawBody) {
  if (env.NODE_ENV === "production" && env.RAPID_GATEWAY_MODE !== "LIVE")
    throw new AppError(
      503,
      "PAYMENT_GATEWAY_DISABLED",
      "Sandbox webhooks are disabled in production",
    );
  if (!env.RAPID_GATEWAY_WEBHOOK_SECRET)
    throw new AppError(
      503,
      "PAYMENT_WEBHOOK_NOT_CONFIGURED",
      "Payment webhook is not configured",
    );
  const signature = headers["x-rapidgateway-signature"];
  const timestamp = headers["x-rapidgateway-timestamp"];
  if (!validTimestamp(timestamp))
    throw new AppError(
      401,
      "PAYMENT_WEBHOOK_TIMESTAMP_INVALID",
      "Payment webhook timestamp is invalid",
    );
  const expected = crypto
    .createHmac("sha256", env.RAPID_GATEWAY_WEBHOOK_SECRET)
    .update(String(timestamp))
    .update(".")
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
  if (!safeEqualHex(expected, String(signature || "")))
    throw new AppError(
      401,
      "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
      "Payment webhook signature is invalid",
    );
}

async function startCheckout(userId, orderId, input, correlationId) {
  if (env.RAPID_GATEWAY_MODE === "LIVE" && input.testScenario)
    throw new AppError(
      400,
      "TEST_SCENARIO_NOT_ALLOWED",
      "Sandbox scenarios are not allowed in LIVE mode",
    );
  const attempt = await db.transaction(async (runner) => {
    const orderResult = await runner.query(
      `SELECT o.*,u.email,org.name AS organization_name
       FROM app.orders o JOIN app.users u ON u.id=o.buyer_id
       JOIN app.organizations org ON org.id=o.organization_id
       WHERE o.id=$1 AND o.buyer_id=$2 FOR UPDATE OF o`,
      [orderId, userId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order unavailable");
    if (
      order.status !== "pending_payment" ||
      new Date(order.payment_due_at) <= new Date()
    )
      throw new AppError(
        409,
        "ORDER_NOT_PAYABLE",
        "This order is not currently awaiting payment",
      );

    const existing = await runner.query(
      `SELECT * FROM app.payment_attempts
       WHERE order_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [orderId, input.requestKey],
    );
    if (existing.rowCount) {
      const found = existing.rows[0];
      if (found.amount_minor !== order.total_minor)
        throw new AppError(
          409,
          "PAYMENT_ATTEMPT_MISMATCH",
          "Payment attempt no longer matches this order",
        );
      if (found.checkout_url && ["created", "pending"].includes(found.status))
        return { ...found, order, replay: true };
      throw new AppError(
        409,
        "PAYMENT_ATTEMPT_ALREADY_USED",
        "Use a new payment attempt for this order",
      );
    }

    const inserted = await runner.query(
      `INSERT INTO app.payment_attempts(
         order_id,provider,method,amount_minor,currency,idempotency_key,
         provider_reference,status,expires_at
       ) VALUES($1,$2,'hosted_checkout',$3,'PKR',$4,$5,'created',$6)
       RETURNING *`,
      [
        orderId,
        PROVIDER,
        order.total_minor,
        input.requestKey,
        `RPK${crypto.randomUUID().replaceAll("-", "")}`,
        order.payment_due_at,
      ],
    );
    return { ...inserted.rows[0], order, replay: false };
  });

  if (attempt.replay) return publicAttempt(attempt);

  const returnUrl = new URL("/payment/return", env.APP_URL);
  returnUrl.searchParams.set("order", orderId);
  returnUrl.searchParams.set("attempt", attempt.id);
  let checkoutUrl;
  try {
    checkoutUrl = await createHostedCheckout({
      order: attempt.order,
      attempt,
      mobile: input.mobile,
      email: attempt.order.email,
      merchantName: attempt.order.organization_name,
      returnUrl: returnUrl.toString(),
      testScenario: input.testScenario,
    });
  } catch (error) {
    await db.query(
      `UPDATE app.payment_attempts SET status='failed',updated_at=now()
       WHERE id=$1 AND status='created'`,
      [attempt.id],
    );
    throw error;
  }
  const saved = await db.query(
    `UPDATE app.payment_attempts SET checkout_url=$2,status='pending',updated_at=now()
     WHERE id=$1 AND status='created' RETURNING *`,
    [attempt.id, checkoutUrl],
  );
  await db.query(
    `INSERT INTO app.order_events(order_id,actor_id,event_type,prior_status,new_status,reason,correlation_id,metadata)
     VALUES($1,$2,'payment.checkout_started','pending_payment','pending_payment',$3,$4,$5::jsonb)`,
    [
      orderId,
      userId,
      null,
      correlationId,
      JSON.stringify({ attemptId: attempt.id, provider: PROVIDER }),
    ],
  );
  return publicAttempt({ ...saved.rows[0], order: attempt.order });
}

function publicAttempt(attempt) {
  return {
    id: attempt.id,
    status: attempt.status,
    checkoutUrl: attempt.checkout_url,
    amountMinor: attempt.amount_minor,
    currency: attempt.currency,
    expiresAt: attempt.expires_at,
  };
}

async function getAttempt(userId, attemptId) {
  const result = await db.query(
    `SELECT p.id,
       CASE
         WHEN p.status IN ('succeeded','failed','expired','refund_pending','refunded')
           THEN p.status
         WHEN p.expires_at <= now() OR o.status IN (
           'payment_expired','group_open','group_expired','withdrawn','rejected','seller_expired'
         ) THEN 'expired'
         ELSE p.status
       END AS status,
       p.amount_minor,p.currency,p.expires_at,p.created_at,
       o.id AS order_id,o.status AS order_status,
       EXISTS (
         SELECT 1 FROM app.order_events e
         WHERE e.order_id=o.id
           AND e.event_type='payment.late_success_requires_review'
           AND e.metadata->>'attemptId'=p.id::text
       ) AS reconciliation_required
     FROM app.payment_attempts p JOIN app.orders o ON o.id=p.order_id
     WHERE p.id=$1 AND o.buyer_id=$2`,
    [attemptId, userId],
  );
  if (!result.rowCount)
    throw new AppError(
      404,
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Payment attempt unavailable",
    );
  return result.rows[0];
}

async function processWebhook(headers, rawBody, payload) {
  verifyWebhook(headers, rawBody);
  const eventId = payload?.eventId;
  const eventType = payload?.eventType;
  if (typeof eventId !== "string" || !eventId || typeof eventType !== "string")
    throw new AppError(
      400,
      "PAYMENT_WEBHOOK_INVALID",
      "Payment webhook payload is invalid",
    );
  if (!["transaction.completed", "transaction.failed"].includes(eventType))
    return { received: true, ignored: true };
  if (
    headers["x-rapidgateway-event"] &&
    headers["x-rapidgateway-event"] !== eventType
  )
    throw new AppError(
      400,
      "PAYMENT_WEBHOOK_INVALID",
      "Payment webhook event header does not match its payload",
    );

  const amountMinor = amountToMinor(payload.amount);
  const desiredStatus =
    eventType === "transaction.completed" ? "succeeded" : "failed";
  if (
    !amountMinor ||
    payload.status !== (desiredStatus === "succeeded" ? "SUCCESS" : "FAILED") ||
    payload.currency !== "PKR" ||
    payload.environment !== env.RAPID_GATEWAY_MODE ||
    String(payload.merchantId) !== env.RAPID_GATEWAY_MERCHANT_ID
  )
    throw new AppError(
      400,
      "PAYMENT_WEBHOOK_INVALID",
      "Payment webhook does not match this gateway configuration",
    );

  return db.transaction(async (runner) => {
    const duplicate = await runner.query(
      "SELECT 1 FROM app.payment_events WHERE provider=$1 AND provider_event_id=$2",
      [PROVIDER, eventId],
    );
    if (duplicate.rowCount) return { received: true, duplicate: true };

    const attemptResult = await runner.query(
      `SELECT p.*,o.status AS order_status,o.payment_due_at,o.group_id,o.organization_id
       FROM app.payment_attempts p JOIN app.orders o ON o.id=p.order_id
       WHERE p.provider=$1 AND p.provider_reference=$2 FOR UPDATE OF p,o`,
      [PROVIDER, payload.merchantTransactionId],
    );
    const attempt = attemptResult.rows[0];
    if (!attempt || BigInt(attempt.amount_minor) !== amountMinor)
      throw new AppError(
        404,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "Matching payment attempt not found",
      );

    const inserted = await runner.query(
      `INSERT INTO app.payment_events(
         payment_attempt_id,provider,provider_event_id,event_type,payload_hash,
         signature_verified,processed_at
       ) VALUES($1,$2,$3,$4,$5,true,now())
       ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,
      [
        attempt.id,
        PROVIDER,
        eventId,
        eventType,
        crypto.createHash("sha256").update(rawBody).digest("hex"),
      ],
    );
    if (!inserted.rowCount) return { received: true, duplicate: true };
    if (!["created", "pending"].includes(attempt.status))
      return { received: true, ignored: true };

    await runner.query(
      "UPDATE app.payment_attempts SET status=$2,updated_at=now() WHERE id=$1",
      [attempt.id, desiredStatus],
    );
    if (desiredStatus === "failed") return { received: true };

    if (
      attempt.order_status !== "pending_payment" ||
      new Date(attempt.payment_due_at) <= new Date()
    ) {
      await runner.query(
        `INSERT INTO app.order_events(order_id,event_type,prior_status,new_status,reason,metadata)
         VALUES($1,'payment.late_success_requires_review',$2,$2,'Provider reported success after order became unpayable',$3::jsonb)`,
        [
          attempt.order_id,
          attempt.order_status,
          JSON.stringify({ attemptId: attempt.id }),
        ],
      );
      await runner.query(
        `INSERT INTO app.audit_events(organization_id,action,resource_type,resource_id,reason,metadata)
         VALUES($1,'payment.late_success_requires_review','payment_attempt',$2,'Payment succeeded after order became unpayable',$3::jsonb)`,
        [
          attempt.organization_id,
          attempt.id,
          JSON.stringify({ orderId: attempt.order_id }),
        ],
      );
      return { received: true, reconciliationRequired: true };
    }

    await runner.query(
      `UPDATE app.orders SET status='paid',paid_at=now()
       WHERE id=$1 AND status='pending_payment'`,
      [attempt.order_id],
    );
    await runner.query(
      `UPDATE app.inventory_reservations SET status='committed',committed_at=now()
       WHERE order_id=$1 AND status='active'`,
      [attempt.order_id],
    );
    await runner.query(
      `INSERT INTO app.order_events(order_id,event_type,prior_status,new_status,reason,metadata)
       VALUES($1,'payment.succeeded','pending_payment','paid','Verified RapidGateway webhook',$2::jsonb)`,
      [
        attempt.order_id,
        JSON.stringify({ attemptId: attempt.id, providerEventId: eventId }),
      ],
    );
    await runner.query(
      `INSERT INTO app.audit_events(organization_id,action,resource_type,resource_id,reason,metadata)
       VALUES($1,'payment.succeeded','order',$2,'Verified RapidGateway webhook',$3::jsonb)`,
      [
        attempt.organization_id,
        attempt.order_id,
        JSON.stringify({ attemptId: attempt.id }),
      ],
    );
    if (attempt.group_id) {
      const remaining = await runner.query(
        `SELECT count(*)::int AS unpaid FROM app.orders
         WHERE group_id=$1 AND status <> 'paid'`,
        [attempt.group_id],
      );
      if (remaining.rows[0].unpaid === 0)
        await runner.query(
          "UPDATE app.purchase_groups SET status='paid',updated_at=now() WHERE id=$1 AND status='payment_open'",
          [attempt.group_id],
        );
    }
    return { received: true };
  });
}

module.exports = { startCheckout, getAttempt, processWebhook };
