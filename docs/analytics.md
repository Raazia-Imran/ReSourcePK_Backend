# Analytics and Reporting Specification

## Principles

Reports answer a role's next decision. They are not decorative charts. Every metric has a written formula, source records, date/timezone filter, drill-down and export. GMV is never presented as revenue.

## Dashboard map

| View | Weekly decision | Monthly/yearly decision | Key measures |
|---|---|---|---|
| Buyer | Join/pay/collect which pool? | Which suppliers/materials are reliable and affordable? | spend, active pools, contribution status, orders, requirement matches, completed-purchase impact |
| Owner / CEO | Is recovered inventory/value improving? | Which material/seller strategy and team investment works? | GMV, seller proceeds, refunds, inventory value/ageing, pool conversion, fulfilment SLA, repeat buyers, impact |
| Manager | What needs attention today? | Where is the operational bottleneck? | unreviewed listings, open/near-expiry pools, late orders, payment exceptions, inventory ageing, team workload |
| Staff | What task must I complete? | What is my permitted workload/outcome? | assigned listings/orders, reservation status, task SLA, permitted stock updates |
| Platform Admin | What threatens safety/reliability? | Is the marketplace healthy and growing? | active users/orgs, moderation/disputes, payment/anchor failures, GMV/fees if enabled, audit/security events |

## Calculation definitions

- GMV: accepted paid order item totals before platform fees and refunds for the selected period.
- Seller proceeds: paid seller-entitled ledger credits minus refunds/adjustments.
- Platform revenue: earned platform-fee ledger credits only; zero when no fee rule exists.
- Refund rate: refunded value divided by paid value for the displayed cohort.
- Inventory value: active available quantity multiplied by current tier/listing unit price; it is an estimate, not cash or profit.
- Pool conversion: pools reaching target divided by pools closed in the period.
- Impact diverted: completed, non-reversed accepted quantity, grouped by canonical unit.
- Fulfilment SLA: duration between paid, ready, dispatched and delivered states; show count and excluded records.

## Report centre

Users select current/previous week, month, year or custom range; apply permitted filters; inspect headline metric, time series, composition/table and operational records; then export authorized CSV or formatted PDF. Every report includes its period, timezone, filters, generation time and metric definitions.

## Security and correctness

The server calculates aggregates. Browser charts receive only authorized data. Large exports run as jobs, expire after download and are audit logged. Ownership-only financial reports are not available to managers/staff without an explicit permission. Charts have accessible table equivalents.
