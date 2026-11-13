const { query } = require("../db");

// Filter fragments are selected by application code only, never request input.
async function commerceMetrics({ organizationId = null, from, to }) {
  const result = await query(
    `WITH scoped AS (
       SELECT o.* FROM app.orders o JOIN app.listings l ON l.id=o.listing_id
       JOIN app.users u ON u.id=o.buyer_id
       WHERE l.is_demo=false AND NOT EXISTS(SELECT 1 FROM app.demo_seed_records d WHERE d.kind='user' AND d.record_id=u.id)
         AND ($1::uuid IS NULL OR o.organization_id=$1)
         AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
     ), payment AS (
       SELECT p.* FROM app.payment_attempts p JOIN scoped o ON o.id=p.order_id
     ), paid_orders AS (
       SELECT DISTINCT order_id FROM payment WHERE status IN ('succeeded','refunded')
     ), customers AS (
       SELECT o.buyer_id,count(*)::int AS orders FROM scoped o
       JOIN paid_orders p ON p.order_id=o.id GROUP BY o.buyer_id
     ), groups AS (
       SELECT g.* FROM app.purchase_groups g JOIN app.listings l ON l.id=g.listing_id
       WHERE l.is_demo=false AND ($1::uuid IS NULL OR g.organization_id=$1)
         AND g.created_at >= $2::timestamptz AND g.created_at < $3::timestamptz
     )
     SELECT
       (SELECT count(*)::int FROM scoped) AS placed_orders,
       (SELECT count(*)::int FROM paid_orders) AS paid_orders,
       (SELECT COALESCE(sum(o.total_minor),0)::text FROM scoped o JOIN paid_orders p ON p.order_id=o.id) AS paid_gmv_minor,
       (SELECT count(*)::int FROM customers) AS purchasing_customers,
       (SELECT count(*)::int FROM customers WHERE orders > 1) AS repeat_customers,
       (SELECT count(*)::int FROM scoped WHERE fulfilment_status='completed') AS completed_orders,
       (SELECT count(*)::int FROM scoped WHERE fulfilment_status='cancelled' OR status IN ('cancelled','rejected','expired')) AS cancelled_orders,
       (SELECT count(*)::int FROM scoped WHERE fulfilment_status='refunded' OR status='refunded') AS refunded_orders,
       (SELECT COALESCE(sum(total_minor),0)::text FROM scoped WHERE fulfilment_status='refunded' OR status='refunded') AS recorded_refund_minor,
       (SELECT count(*)::int FROM payment) AS payment_attempts,
       (SELECT count(*)::int FROM payment WHERE status IN ('succeeded','refunded')) AS successful_attempts,
       (SELECT count(*)::int FROM groups WHERE status IN ('paid','expired')) AS closed_groups,
       (SELECT count(*)::int FROM groups WHERE status='paid') AS confirmed_groups`,
    [organizationId, from, to],
  );
  return {
    ...result.rows[0],
    period: {
      from,
      to,
      basis:
        "Orders and groups created in this UTC period; payment attempts linked to those orders",
    },
    financialBasis:
      "Recorded payment states including sandbox activity, not bank settlement or platform revenue",
    unavailable: [
      {
        name: "Platform revenue and take rate",
        reason: "Commission and settlement ledger is not implemented",
      },
      {
        name: "Gross margin and net profit",
        reason: "Cost of goods and operating expenses are not recorded",
      },
      {
        name: "Customer acquisition cost (CAC)",
        reason: "Marketing spend and acquisition attribution are not recorded",
      },
      {
        name: "Customer lifetime value (CLV)",
        reason:
          "Validated margin and customer retention history are not available",
      },
      {
        name: "Visitor conversion and cart abandonment",
        reason: "Visitor, cart and checkout funnel events are not collected",
      },
      {
        name: "Inventory turnover",
        reason:
          "Costed inventory and a reliable average inventory history are not recorded",
      },
      {
        name: "CO2 and water savings",
        reason:
          "No reviewed material-specific environmental factors are configured",
      },
    ],
  };
}
module.exports = { commerceMetrics };
