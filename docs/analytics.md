# Analytics and Reporting Specification

> This document describes both the delivered operational dashboards and the larger reporting target. Platform traffic, ledger revenue, verified diversion and exports remain out of scope until their source records exist; see [Current Features and Scope](current-features.md).

## Principles

Reports answer a role's next decision. They are not decorative charts. Every metric has a written formula, source records, date/timezone filter, drill-down and export. GMV is never presented as revenue.

## Dashboard map

| View                                | Weekly decision                         | Monthly/yearly decision                                   | Key measures                                                                                                                   |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Buyer                               | Join/pay/collect which pool?            | Which suppliers/materials are reliable and affordable?    | spend, active pools, contribution status, orders, requirement matches, completed-purchase impact                               |
| Owner / CEO                         | Is recovered inventory/value improving? | Which material/seller strategy and team investment works? | GMV, seller proceeds, refunds, inventory value/ageing, pool conversion, fulfilment SLA, repeat buyers, impact                  |
| Manager                             | What needs attention today?             | Where is the operational bottleneck?                      | unreviewed listings, open/near-expiry pools, late orders, payment exceptions, inventory ageing, team workload                  |
| Staff                               | What task must I complete?              | What is my permitted workload/outcome?                    | assigned listings/orders, reservation status, task SLA, permitted stock updates                                                |
| Platform Admin / permitted Reviewer | What threatens safety/reliability?      | Is the marketplace healthy and growing?                   | traffic, joined organizations, staff counts, moderation and audit events; later payment/anchor metrics and GMV/fees if enabled |

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

## Delivered operational dashboards — 21 October 2026

The current UI now has live operational views for Buyer purchase activity, Seller listing/order activity, organization name settings, Platform Admin organization and user directories, and Platform Admin operational analytics. Their API reads are authorized server-side. Seller and platform aggregate metrics exclude `is_demo` listings; directories include seeded records with a visible demo label.

The Buyer impact view reports order state, paid order quantity/value, and recent orders. It does not claim that paid quantity is verified waste diversion. Seller reporting shows listing states, order states, requested quantity, recorded paid-value totals, and monthly order counts. Platform reporting shows account, organization, listing, Seller application, order, and recent audit-event counts. Settings currently permit only the Owner to change the organization name; the workspace slug is immutable. Organization and user directories are read-only.

Managers need `orders.confirm` to access Seller Orders and Seller Analytics. Staff see Listings only when granted `listings.view` or `listings.manage`; organization settings are Owner-only. Platform directories and analytics are Platform Admin-only. Reviewers continue to see only their assigned review queues.

## Current delivery boundary — 21 October 2026

The operational dashboards are not a financial ledger or full reporting suite. Payment-provider settlement, refunds, verified impact events, date filters, CSV/PDF export, platform traffic, and edit/suspend actions for directory records are not implemented. Paid value means only orders recorded with status `paid`; it is not seller proceeds, GMV settlement, or proof of environmental diversion. Continue to exclude demo listings from live aggregate metrics and label them in administrative directories.
