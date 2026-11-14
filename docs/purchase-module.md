# Purchase ordering rules and data model

Updated: 14 November 2026. This document describes the current purchase lifecycle, including Buyer-created group orders, direct/urgent orders, and RapidGateway payment verification.

## Product decisions accepted by the user

- Phase 3 includes both direct purchases and group orders.
- A Seller confirms an order before the Buyer is asked to pay.
- After Seller confirmation, the Buyer has 48 hours to complete payment.
- Each group participant's price is locked when they join. If a share reopens, a new participant gets a price based on the tier applicable at their join time; existing price snapshots do not change.
- A group's price tier is selected using each individual Buyer's share quantity, not the total quantity contributed by the group.
- For direct orders, the Seller has 48 hours to confirm or reject. An unanswered order expires and its stock reservation is released.
- A Buyer creates a group, sets the total target and join deadline, and offers three or four share-size choices. The target must meet the listing MOQ; a share may be smaller than the MOQ.
- A Buyer may leave before Seller confirmation; their reservation is released.
- When the total target is reached, the group closes to new participants and the Seller has 48 hours to confirm or reject it.
- If the target is missed by the deadline, participants get an email notice and a 48-hour choice window in My purchases. Any current participant may use the one-time 48-hour extension. During the extension, other participants may still leave or switch an eligible share to a Seller-configured urgent direct order at its explicitly shown higher price.
- If the extended group still misses its target, it closes and participants get a final 48-hour window to leave or choose the urgent direct option. No group payment is taken for an under-target group.
- If a confirmed participant does not pay by the deadline, remove that share and reopen its quantity. The Seller reconfirms the revised group before its remaining unpaid participants pay.
- Escrow is not required for the initial flow. Delivery is outside platform scope.

## Implemented rules

These rules define the lifecycle and data-integrity behavior. Remaining choices outside the implementation are listed under [Remaining purchase decisions](#remaining-purchase-decisions).

### Listing eligibility and direct purchase

- Every published listing selects one purchase mode: `direct`, `group`, or `both`. Disabled modes cannot be used by the API even if a client calls the endpoint directly.
- A standard direct order must satisfy the listing MOQ unless the Buyer purchases all currently available stock. A Seller may set a lower urgent minimum for a separate expedited order.
- The Buyer submits a quantity and sees the exact unit price, tier, total, unit, and currency before placing the order. The server revalidates stock, MOQ, mode, and tier inside the transaction that creates the order.
- A direct order enters `pending_seller_confirmation`. The Seller confirms or rejects it within 48 hours. Confirmation fixes the terms and starts the Buyer's 48-hour payment window. Rejection releases its stock reservation.

### Group creation and joining

- A Seller sets a maximum group joining period of 1–7 days on each listing (default 7). A Buyer can create a group only for a published listing with group ordering enabled. The Buyer sets a total target no lower than the listing MOQ and no greater than currently available stock, chooses a join deadline within the Seller's maximum, and provides three or four unique share sizes no larger than the target. The API enforces the maximum even if a client bypasses the date-picker limit.
- Contributions must match one of the listed share sizes or the exact remaining quantity. The API prevents total active contributions from exceeding the group target or available stock. It never silently trims a requested contribution.
- Joining reserves the requested quantity immediately. A Buyer can leave an open, not-yet-confirmed group; leaving releases the reservation. Joining, leaving, and target checks are atomic and idempotent.
- Joined quantities are reserved until the group's displayed closing time or until they are otherwise released. The group stops accepting contributions when it reaches the target or the join deadline. Reaching the target makes it ready for Seller confirmation and starts the Seller's separate 48-hour response window. The Seller may confirm or reject; an unanswered decision expires the group and releases unpaid reservations.
- An under-target group enters `deadline_choices` for 48 hours. One current participant can extend it exactly once for another 48 hours. Other participants can leave or switch eligible shares to urgent direct orders during the extension. On a missed second deadline, the group does not proceed as a smaller group; participants have one final 48-hour period to leave or switch.
- Seller confirmation snapshots the current participant set and starts a separate 48-hour payment deadline for each unpaid participant.
- A missed payment expires that participant's order, releases their reserved quantity, and marks the group as requiring Seller reconfirmation. Paid participants remain paid and their price and order history are unchanged.
- Remaining unpaid participants return to the Seller for confirmation of the revised quantity. The Seller may confirm below the original target at this reconfirmation stage; only unpaid orders receive a new 48-hour payment window. Paid shares remain paid at their original price. If the Seller rejects or times out, only unpaid reservations are released.
- When the current group is fully paid, it becomes `paid`. No dispatch, shipment, or delivery state is managed by ReSource PK.

### Urgent purchase option

- A Seller may configure an urgent per-unit price, a fulfillment turnaround of 1 to 30 days, and an optional urgent minimum. If omitted, the urgent minimum is the regular listing MOQ. The urgent price must be higher than every standard listing price tier.
- During a group's under-target choice window, a participant can convert their unpaid share into a separate urgent direct order if it meets the urgent minimum and stock remains. The Buyer must accept the urgent unit price, total, and turnaround before the system creates the order. The group share reservation is released atomically as the separate order is reserved.
- Urgent orders use the Seller's configured urgent price for the full share, rather than the standard quantity tiers. The price and turnaround are snapshotted on the order and cannot be changed by later listing edits.
- The turnaround deadline begins after the payment webhook is verified. This records the Seller's fulfillment commitment; ReSource PK does not arrange or track shipping.
- A listing without urgent price and turnaround configuration cannot accept urgent orders. Group contributions remain at the regular per-share tier price.

### Inventory and reservations

- The listing's physical quantity is the inventory ceiling. Available quantity is calculated as physical quantity minus active reservations minus quantities committed by paid orders.
- Both a direct order awaiting Seller confirmation and a group contribution reserve stock. A Seller rejection, Buyer withdrawal from an open group, group expiry, or unpaid-order expiry releases the reservation exactly once.
- Successful payment converts the reservation into committed stock in the same transaction that records the paid state. It must not subtract stock twice.
- Listing edits cannot reduce physical quantity below already reserved plus committed stock. Archive/suspension must stop new purchases; handling existing reservations is governed by the cancellation rules still to be confirmed.
- Lock the listing and, for group operations, the group row while validating and writing reservations. Database constraints and idempotency keys protect against concurrent over-selling and duplicate requests.

### Price and immutable order snapshot

- Direct purchase price is calculated from the direct order quantity and the listing's active tier schedule when the Buyer submits it. The Seller sees and confirms those terms; listing edits later do not rewrite an existing order.
- A group participant receives a price snapshot at join time. The snapshot includes the listing/tier version and the unit price then applicable. Seller confirmation, later joins, a deadline decision, or listing price edits never rewrite that participant's snapshot.
- The server calculates the line total from quantity and snapshot unit price. Ignore client-supplied totals. Store money in integer paisa and quantity in fixed-precision numeric columns with an explicit unit. The initial API uses round-half-up to the nearest paisa; confirm this rule before enabling real payments.
- Payment is requested only after Seller confirmation, and the amount must equal the immutable order total. A browser redirect or client claim is not proof of payment; only a verified provider result/callback may mark an order paid.

### State model

Direct order states:

```text
pending_seller_confirmation -> pending_payment -> paid
                            -> rejected
pending_payment -> payment_expired
```

Group states:

```text
open -> ready_for_confirmation -> payment_open -> paid
 |               |                    |
 |               +-> rejected/expired +-> reconfirmation_required
 |                                          |               |
 +-> deadline_choices -> open (one 48h extension)          +-> payment_open
          |                                                   +-> rejected/expired
          +-> expired
          +-> leave or switch share to urgent direct order
```

State changes are service-controlled and recorded in order/audit events. No client may directly assign a lifecycle state.

Payment attempts have their own states (for example `created`, `pending`, `succeeded`, `failed`, `expired`, `refund_pending`, `refunded`) and never replace the authoritative order state. Provider callbacks are signature-verified, idempotent, and uniquely associated with a provider reference. A failed attempt can be retried within the order's payment window; it does not extend the 48-hour deadline.

## Proposed database model

Migrations `013_purchase_foundation.sql` and `014_purchase_workflow_support.sql` create the purchase schema and its workflow support in the existing `app` schema.

| Entity                                                | Purpose and key data                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings` additions                                  | `purchase_mode`; direct/group enablement; existing physical quantity, MOQ, unit, tier schedule, and version remain seller-controlled.                                                                                                                                                                                                                       |
| `purchase_groups`                                     | A Buyer-created pool with listing, Buyer creator, total target, join/choice/Seller deadlines, one-time extension count, lifecycle status, and confirmation fields.                                                                                                                                                                                          |
| `purchase_group_share_options`                        | Three or four quantities offered as the normal per-Buyer share choices for a new group.                                                                                                                                                                                                                                                                     |
| `orders`                                              | One Buyer purchase per listing contribution (direct orders have no group; group contributions reference a group): Buyer, listing/organization/group IDs, idempotency key, quantity/unit, listing version, per-Buyer tier and price snapshot, immutable total in paisa, state, seller-response deadline, confirmation time, payment deadline, and paid time. |
| `order_price_snapshots` or immutable snapshot columns | The initial schema stores listing/tier version, threshold, unit price in paisa, currency, quantity, and total directly on the order and blocks edits to those terms.                                                                                                                                                                                        |
| `inventory_reservations`                              | Unique source order, listing, quantity, status (`active`, `committed`, `released`), create/release/commit timestamps, and release reason. One order cannot hold multiple active duplicate reservations.                                                                                                                                                     |
| `order_events`                                        | Append-only state history and actor/reason; supports audit and support investigations.                                                                                                                                                                                                                                                                      |
| `payment_attempts`                                    | Order, provider, server-calculated amount/currency, idempotency key, provider reference, attempt state, expiry, and timestamps; never store card/bank secrets.                                                                                                                                                                                              |
| `payment_events`                                      | Append-only verified provider events, unique provider event/reference, signature-verification outcome, and processing timestamps.                                                                                                                                                                                                                           |
| Ledger                                                | Deferred to payment/settlement work; settlement route is not yet confirmed, so this schema does not pretend to represent a balanced seller payout or escrow.                                                                                                                                                                                                |
| `audit_events`                                        | Seller decisions, group deadline decisions, membership changes, cancellations/refunds, and administrative corrections with actor, reason, and correlation ID.                                                                                                                                                                                               |

Core constraints: positive quantities; matching listing unit; nonnegative paisa amounts; valid listing/group/order foreign-key relationships; unique idempotency keys; unique provider event/reference; one current reservation per order; group contribution total never above target; no order or group can be paid twice; and no state transition without an event.

## Permissions

- Buyers can create groups and their own orders, pay only their own confirmed unpaid orders, leave their own unpaid group shares, extend a group only as a participant, and switch only their own eligible unpaid share to urgent direct purchase.
- Seller Owners can confirm/reject direct orders and groups. Managers can decide only with `orders.confirm`.
- Managers can perform those Seller decisions only with an Owner-granted `orders.confirm` permission. The Owner remains able to do them.
- Staff receive no order access by default. An order permission for Staff is not defined for Chunk 1 and must not be inferred from listing permissions.
- Platform Admin/Reviewer access to commerce data requires a separately specified support/audit permission; current listing-review grants do not confer order access.

## Acceptance invariants for later implementation

1. Direct checkout is rejected when listing mode, MOQ, available stock, or seller status disallows it.
2. Parallel direct orders and group joins cannot reserve more than available inventory or the group target.
3. Seller rejection and every expiry release the appropriate reservation once; payment converts a reservation to committed stock once.
4. Direct and group participants receive the accepted Seller terms before payment, with immutable price/quantity snapshots.
5. No payment is requested before Seller confirmation; new confirmed unpaid orders expire 48 hours after confirmation. Orders confirmed before the 48-hour policy change keep their original deadline.
6. A nonpayer is removed, their share reopens, and the replacement group requires Seller reconfirmation; paid members are not charged again or repriced.
7. An under-target group permits one participant-triggered 48-hour extension. If still short, unpaid shares can only leave or convert to urgent direct orders; Seller confirmation cannot proceed.
8. Callback replay, request retry, race at deadline, and concurrent Seller/Buyer actions produce one valid state transition and one ledger effect.
9. No delivery/shipping status is added to the purchase lifecycle.

## Remaining purchase decisions

These remain outside this implemented lifecycle:

1. **Post-confirmation and paid-order cancellation/refunds:** cancellation after Seller confirmation or payment, refund authority, and stock treatment remain undefined. Do not assume shipping/returns are managed by the platform.
2. **Money rounding:** the API uses round-half-up to the nearest paisa when decimal quantity multiplied by paisa-per-unit is fractional.

## Implementation status

Implemented routes include Buyer group creation, browsing, joining, leaving, extending, and eligible urgent conversion; Seller group decisions; direct orders; Buyer purchase history; Seller order lists; and a CRON_SECRET-protected deadline worker. The worker emails current group participants when an under-target choice window opens and when the one-time extension begins; Buyer actions remain available in My purchases. RapidGateway TEST checkout and signed webhook verification are implemented. Refunds, settlement, and seller payouts are not implemented. See [OpenAPI](openapi.yaml) for endpoint contracts.

## Related docs

- [PRD](prd.md) — product goals and agreed journey.
- [SRS](srs.md) — functional requirements and acceptance criteria.
- [Tasks](tasks.md) — Phase 3 implementation sequence.
- [Current Features and Scope](current-features.md) — implemented versus planned behavior.
