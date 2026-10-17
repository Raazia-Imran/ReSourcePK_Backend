# Phase 3, Chunk 1: Purchase rules and data model

Updated: 17 October 2026. This document is the working source of truth for Phase 3 purchase behavior. It defines the rules to use before purchase code and migrations are implemented. Nothing in this design means orders, reservations, or payments are already implemented.

## Product decisions accepted by the user

- Phase 3 includes both direct purchases and group orders.
- A Seller confirms an order before the Buyer is asked to pay.
- After Seller confirmation, the Buyer has 3 days (72 hours) to complete payment.
- Each group participant's price is locked when they join. If a share reopens, a new participant gets a price based on the tier applicable at their join time; existing price snapshots do not change.
- A group's price tier is selected using each individual Buyer's share quantity, not the total quantity contributed by the group.
- For direct orders, the Seller has 72 hours to confirm or reject. An unanswered order expires and its stock reservation is released.
- A Buyer may leave an open group before Seller confirmation; their reservation is released.
- Payment integration will start with the Road/Raod gateway sandbox, with JazzCash, Easypaisa, Raast, cards, and bank transfer as desired payment methods. Exact provider identity and sandbox method availability need confirmation before integration.
- A group that reaches its target can be submitted to the Seller for confirmation.
- At the group deadline, the Seller Owner or a Manager with delegated order-confirmation permission chooses to expire the group or confirm its smaller current total.
- If the Seller confirms an under-target group, all current Buyer shares are included unchanged; the Seller cannot select only some participants or reduce a share without that Buyer's agreement.
- If a confirmed participant does not pay by the deadline, remove that participant and reopen their quantity. A replacement participant may join, after which the Seller must confirm the revised group again.
- Escrow is not required for the initial flow. Delivery is outside platform scope.

## Proposed rules for implementation

These rules fill in lifecycle and data-integrity details implied by the accepted decisions. Remaining choices needing confirmation are listed under [Open decisions](#open-decisions-before-purchase-implementation).

### Listing eligibility and direct purchase

- Every published listing selects one purchase mode: `direct`, `group`, or `both`. Disabled modes cannot be used by the API even if a client calls the endpoint directly.
- A direct order must satisfy the listing MOQ, unless the Buyer purchases the entire remaining permitted lot or the Seller has enabled a smaller direct-buy lot.
- The Buyer submits a quantity and sees the exact unit price, tier, total, unit, and currency before placing the order. The server revalidates stock, MOQ, mode, and tier inside the transaction that creates the order.
- A direct order enters `pending_seller_confirmation`. The Seller confirms or rejects it. Confirmation fixes the terms and starts the 72-hour payment window. Rejection releases its stock reservation.

### Group creation and joining

- A group can only be created for a published listing with group ordering enabled. A Seller sets a target quantity no greater than the listing's currently available stock and a join deadline.
- Contributions are positive quantities in the listing's unit. The API prevents total active contributions from exceeding the group target or available stock. The API does not silently trim a requested contribution.
- Joining reserves the requested quantity immediately. A Buyer can leave an open, not-yet-confirmed group; leaving releases the reservation. Joining, leaving, and target checks are atomic and idempotent.
- The group stops accepting contributions at its target or deadline. At target, it becomes ready for Seller confirmation. At deadline below target, the authorized Seller decision is either expire it or confirm the full current contribution total as a smaller group. Confirmation includes every current share unchanged; changing a participant's quantity requires that Buyer's agreement.
- Seller confirmation snapshots the current participant set and starts a separate 72-hour payment deadline for each unpaid participant.
- A missed payment expires that participant's order, releases their reserved quantity, and marks the group as requiring Seller reconfirmation before replacement participants are asked to pay. Paid participants remain paid and their price and order history are unchanged.
- A replacement Buyer joins at the reopened quantity, receives a new price snapshot, and remains unpaid until the Seller reconfirms the revised group. The Seller's reconfirmation starts a new 72-hour window for the currently included unpaid participants; it does not create duplicate orders or charges for already-paid participants.
- When the current group is fully paid, it becomes `paid`. No dispatch, shipment, or delivery state is managed by ReSource PK.

### Inventory and reservations

- The listing's physical quantity is the inventory ceiling. Available quantity is calculated as physical quantity minus active reservations minus quantities committed by paid orders.
- Both a direct order awaiting Seller confirmation and a group contribution reserve stock. A Seller rejection, Buyer withdrawal from an open group, group expiry, or unpaid-order expiry releases the reservation exactly once.
- Successful payment converts the reservation into committed stock in the same transaction that records the paid state. It must not subtract stock twice.
- Listing edits cannot reduce physical quantity below already reserved plus committed stock. Archive/suspension must stop new purchases; handling existing reservations is governed by the cancellation rules still to be confirmed.
- Lock the listing and, for group operations, the group row while validating and writing reservations. Database constraints and idempotency keys protect against concurrent over-selling and duplicate requests.

### Price and immutable order snapshot

- Direct purchase price is calculated from the direct order quantity and the listing's active tier schedule when the Buyer submits it. The Seller sees and confirms those terms; listing edits later do not rewrite an existing order.
- A group participant receives a price snapshot at join time. The snapshot includes the listing/tier version and the unit price then applicable. Seller confirmation, later joins, a deadline decision, or listing price edits never rewrite that participant's snapshot.
- The server calculates the line total from quantity and snapshot unit price. Ignore client-supplied totals. Store money in integer paisa and quantity in fixed-precision numeric columns with an explicit unit.
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
open -> target_reached -> pending_seller_confirmation -> payment_open -> paid
  |             |                    |                       |
  + deadline --+                    +-> expired             +-> reconfirmation_required
       -> expired or seller-confirmed-smaller                       |
                                                       replacement join -> pending_seller_confirmation
```

The state names are proposals for the API/database. State changes must be explicit service operations and append an `order_event` with actor, timestamp, reason, prior state, and new state. No client may directly assign a lifecycle state.

Payment attempts have their own states (for example `created`, `pending`, `succeeded`, `failed`, `expired`, `refund_pending`, `refunded`) and never replace the authoritative order state. Provider callbacks are signature-verified, idempotent, and uniquely associated with a provider reference. A failed attempt can be retried within the order's payment window; it does not extend the 72-hour deadline.

## Proposed database model

Migration `013_purchase_foundation.sql` creates the initial purchase schema in the existing `app` schema. The service layer and APIs that enforce these records are subsequent work.

| Entity                                                | Purpose and key data                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings` additions                                  | `purchase_mode`; direct/group enablement; optional smaller-direct-lot setting; existing physical quantity, MOQ, unit, tier schedule, and version remain seller-controlled.                                                                                                                                                                                  |
| `purchase_groups`                                     | One group per listing/offer: `listing_id`, `organization_id`, `target_quantity`, `closes_at`, `status`, optimistic `version`, and confirmation/decision timestamps and actor.                                                                                                                                                                               |
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

- Buyers can create and view only their own orders/group contributions, pay only their own confirmed unpaid orders, and leave only an open pre-confirmation group.
- Seller Owners can confirm/reject direct orders, confirm groups, and choose the deadline outcome.
- Managers can perform those Seller decisions only with an Owner-granted `orders.confirm` permission. The Owner remains able to do them.
- Staff receive no order access by default. An order permission for Staff is not defined for Chunk 1 and must not be inferred from listing permissions.
- Platform Admin/Reviewer access to commerce data requires a separately specified support/audit permission; current listing-review grants do not confer order access.

## Acceptance invariants for later implementation

1. Direct checkout is rejected when listing mode, MOQ, available stock, or seller status disallows it.
2. Parallel direct orders and group joins cannot reserve more than available inventory or the group target.
3. Seller rejection and every expiry release the appropriate reservation once; payment converts a reservation to committed stock once.
4. Direct and group participants receive the accepted Seller terms before payment, with immutable price/quantity snapshots.
5. No payment is requested before Seller confirmation; all confirmed unpaid orders expire exactly 72 hours after their confirmation deadline.
6. A nonpayer is removed, their share reopens, and the replacement group requires Seller reconfirmation; paid members are not charged again or repriced.
7. Seller can expire an under-target group or confirm all current shares unchanged at the deadline, with an audited reason.
8. Callback replay, request retry, race at deadline, and concurrent Seller/Buyer actions produce one valid state transition and one ledger effect.
9. No delivery/shipping status is added to the purchase lifecycle.

## Open decisions before purchase implementation

These do not block documenting the initial model, but must be confirmed before the affected service/migration behavior is treated as final:

1. **Payment provider and settlement:** confirm the gateway's exact name (the user called it “Raod”) and that its sandbox account/API supports JazzCash, Easypaisa, Raast, cards, and bank transfers. Confirm settlement route before live payments. “No escrow” does not itself define the provider's settlement route.
2. **Post-confirmation and paid-order cancellation/refunds:** open-group withdrawal before Seller confirmation is allowed. Still confirm whether a Buyer may cancel after Seller confirmation or payment, who can authorize refunds, and whether paid quantity can return to stock. Do not assume shipping/returns are managed by the platform.
3. **Money rounding:** confirm the rule when decimal quantity multiplied by paisa-per-unit does not result in a whole paisa. Recommended default is deterministic round-half-up to the nearest paisa, calculated server-side.

## Implementation status

Migration `013_purchase_foundation.sql` adds listing purchase modes, groups, orders with immutable terms, inventory reservations, order history, and generic payment-attempt/event records. It does not implement purchase endpoints, reservation transitions, payment processing, refunds, or gateway integration. Those are subsequent Phase 3 chunks.

## Related docs

- [PRD](prd.md) — product goals and agreed journey.
- [SRS](srs.md) — functional requirements and acceptance criteria.
- [Tasks](tasks.md) — Phase 3 implementation sequence.
- [Current Features and Scope](current-features.md) — implemented versus planned behavior.
