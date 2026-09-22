# Software Requirements Specification

## Purpose and system boundary

This specification defines the MVP behavior of the KapraLoop responsive web platform. PostgreSQL is the system of record. External providers (email, storage, payments, optional tagging, Polygon) are adapters and must not own core business state.

## Functional requirements

### Identity and access

- **FR-AUTH-01:** Register with email and password; normalize email and prevent duplicates.
- **FR-AUTH-02:** Require single-use email verification before marketplace actions.
- **FR-AUTH-03:** Support login, logout, password reset, short-lived access tokens, rotating refresh sessions, and session revocation.
- **FR-AUTH-04:** Apply rate limits and temporary lockout to authentication and invite endpoints.
- **FR-AUTH-05:** Enforce authorization in the API for every protected resource; hidden UI is not authorization.
- **FR-AUTH-06:** Platform roles and organization roles are separate. A user may hold memberships in multiple organizations.
- **FR-AUTH-07:** Invitations contain organization, email, role, inviter, expiry and nonce; store only a token hash; accept once.
- **FR-AUTH-08:** A member cannot grant a role or permission above their own grant boundary.

### Organizations and users

- **FR-ORG-01:** Create seller organization with legal/display name, contact, location and verification status.
- **FR-ORG-02:** Owner can invite, suspend, reactivate, change permitted roles, and transfer ownership with step-up authentication.
- **FR-ORG-03:** Every membership/permission change emits an audit event.

### Catalog and discovery

- **FR-CAT-01:** Seller members with permission can create, edit, archive and submit listings.
- **FR-CAT-02:** Listing includes material category, composition if known, color, condition, quantity, unit, MOQ, location, images, pricing tiers and status.
- **FR-CAT-03:** Published listings are searchable by keyword and filterable/sortable using indexed fields.
- **FR-CAT-04:** Buyers can post, pause and close requirements; matching is deterministic and explainable.
- **FR-CAT-05:** Uploads are size/type limited, renamed, scanned when supported, and served from object storage.

### Pools, orders and inventory

- **FR-POOL-01:** Seller or system can open a pool with target, minimum contribution, close time and tier schedule.
- **FR-POOL-02:** Joining a pool is transactional, idempotent and concurrency safe.
- **FR-POOL-03:** System prevents contribution beyond available quantity and releases expired unpaid reservations.
- **FR-POOL-04:** Pool states: `draft`, `open`, `target_met`, `locked`, `cancelled`, `expired`, `converted`.
- **FR-ORD-01:** Order states: `pending_payment`, `paid`, `processing`, `ready`, `dispatched`, `delivered`, `completed`, `cancelled`, `refunded`, `disputed`.
- **FR-ORD-02:** Only allowed state transitions are accepted and each transition records actor, time, reason and prior state.

### Payments and ledger

- **FR-PAY-01:** Provider integration is behind a payment adapter; sandbox or simulator implements the same contract.
- **FR-PAY-02:** Server creates amount, currency, reference and signed request; client-supplied totals are ignored.
- **FR-PAY-03:** Callback signatures and provider references are verified before state changes.
- **FR-PAY-04:** Duplicate create/callback/refund requests are harmless through idempotency keys and unique constraints.
- **FR-PAY-05:** Append-only ledger records charge, contribution, platform fee, refund and adjustment entries whose debits/credits reconcile.
- **FR-PAY-06:** Provider secrets never reach browser code, logs or source control.

### Fulfilment, trust and impact

- **FR-TRUST-01:** Messaging, if shipped, is tied to a listing/order and subject to access checks.
- **FR-TRUST-02:** A completed transaction allows one buyer-to-seller and one seller-to-buyer review; moderation preserves history.
- **FR-PASS-01:** Create versioned canonical JSON from immutable completion fields and hash with SHA-256.
- **FR-PASS-02:** Queue Polygon anchoring and expose `pending`, `anchored`, or `failed`; retries must not create a second first-version record.
- **FR-PASS-03:** Public verification reveals no private buyer, seller, price, message, address, phone or email data.
- **FR-IMP-01:** Diversion quantity is derived from completed transactions, reversed for refunds/returns, and traceable to source orders.

### Administration

- **FR-ADM-01:** Platform Admin can review users, organizations, listings, disputes and flagged reviews under explicit permissions.
- **FR-ADM-02:** Sensitive actions require reason capture and appear in immutable audit logs.
- **FR-ADM-03:** No UI-accessible role has unrestricted database access. Break-glass production access is time-bound and separately audited.

## Non-functional requirements

- **NFR-SEC:** OWASP-aligned validation, parameterized queries, secure headers, CSRF protection where cookie auth is used, least privilege, secret rotation, dependency scanning and audit logging.
- **NFR-PERF:** p95 cached/list reads under 500 ms and writes under 800 ms under agreed demo load, excluding external-provider latency.
- **NFR-REL:** Health/readiness endpoints, structured logs, correlation IDs, graceful shutdown, retry with backoff, and no blocking blockchain call in a user request.
- **NFR-DATA:** UTC timestamps, UUID identifiers, database constraints, migrations, daily managed backups, tested restore, retention policy, and soft deletion where auditability is required.
- **NFR-UX:** Responsive 360-1440+ px, keyboard accessible, WCAG 2.2 AA target, clear empty/loading/error/success states, and reduced-motion support.
- **NFR-PRIV:** Data minimization, purpose limitation, masked admin displays, export/delete process, and no personal data on-chain.
- **NFR-MAINT:** Feature-based modules, OpenAPI contract, lint/format/test gates, ADRs for major decisions, and no business logic in controllers or React components.

## Core entities

`users`, `sessions`, `organizations`, `organization_memberships`, `invitations`, `permissions`, `listings`, `listing_images`, `price_tiers`, `requirements`, `matches`, `pools`, `pool_contributions`, `inventory_reservations`, `orders`, `order_items`, `order_events`, `payment_attempts`, `payment_events`, `ledger_entries`, `shipments`, `disputes`, `reviews`, `passport_snapshots`, `blockchain_anchors`, `impact_events`, `notifications`, `audit_events`.

All mutable business tables include `created_at`, `updated_at`, and optimistic version or equivalent where concurrent updates matter. Tenant-owned rows include `organization_id` and are filtered in repository/service code plus database policy where supported.

## Acceptance scenarios

1. An expired or already-used invitation is rejected without creating membership.
2. A Manager lacking `members.invite` cannot invite Staff; an Org Admin cannot create a Platform Admin.
3. Two concurrent joins cannot overfill a pool or double-reserve stock.
4. Replaying a payment callback leaves one payment transition and one ledger effect.
5. A completed order cannot have passport source fields edited; return/refund creates linked events.
6. Changing a passport snapshot produces a mismatch against the on-chain hash.
7. An administrator cannot view another organization’s private data without an authorized platform moderation workflow.
