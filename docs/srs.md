# Software Requirements Specification

> **Scope note (17 October 2026):** Requirements below describe the intended product. They are not proof of implementation. See [Current Features and Scope](current-features.md) for implemented backend behavior and [Purchase Module](purchase-module.md) for Phase 3 purchase decisions, proposed state model, and open choices.

## Purpose and system boundary

This specification defines the MVP behavior of the ReSource PK responsive web platform. PostgreSQL is the system of record. External providers (email, storage, payments, optional tagging, Polygon) are adapters and must not own core business state.

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
- **FR-AUTH-09:** Support separate Buyer and Seller Google Identity Services entry points using server-verified ID tokens (signature, issuer, expiry, purpose-specific single-use nonce, audience, stable `sub`, and verified email). Both entry points resolve to the same canonical user and Google identity. A person may retain Buyer access while Seller access is requested and reviewed. Google identity alone never grants Seller organization membership or platform permissions.
- **FR-AUTH-10:** Store Google provider identity separately from user email. Existing accounts link Google only while authenticated to that account and only when verified emails match; do not silently merge accounts by email. Google-only accounts may have no password hash and must not authenticate through password login.

### Seller onboarding review

- **FR-SELLER-01:** An active verified Buyer can submit a Seller access request with an organization name and view their own request history. A pending request grants no organization membership or Seller permissions.
- **FR-SELLER-02:** Only active, verified Platform Admins and Reviewers granted `seller_requests.review` can list requests and approve or reject pending requests. Rejection requires a review note; decisions are audited and cannot be applied twice.
- **FR-SELLER-03:** Approval atomically creates the requested organization and Owner membership for the applicant while preserving Buyer capability. Direct seller registration and direct organization creation must not bypass approval.
- **FR-SELLER-04:** Platform Admins invite Reviewers by email and assign or replace their `seller_requests.review` and/or `listings.review` grants. Invites are one-time, email-bound and expire after 72 hours. Admins can review requests and listings themselves; Reviewer management remains Admin-only. Additional platform activity, user, and organization permissions are future scope.

### Organizations and users

- **FR-ORG-01:** An approved Seller request creates the seller organization and Owner membership; direct organization creation cannot bypass review.
- **FR-ORG-02:** Owner can invite Managers and Staff. A Manager can invite Staff when the Owner grants `can_invite_staff`. Owners and authorized Managers can grant/revoke Staff `listings.view` and `listings.manage`; Staff have no listing access by default and cannot grant permissions. Listing management includes view. For Phase 3, the Owner can confirm/reject direct orders and confirm groups; a Manager may do so only with an Owner-granted `orders.confirm` permission. Staff and platform reviewers receive no purchase permissions by default. Further membership lifecycle, role changes, and ownership transfer require separately specified authorization and step-up behavior.
- **FR-ORG-03:** Every membership/permission change emits an audit event.

### Catalog and discovery

- **FR-CAT-01:** Seller members with permission can create, edit, archive and submit listings.
- **FR-CAT-02:** Listing includes material category, composition if known, color, condition, quantity, unit, MOQ, location, images, pricing tiers and status.
- **FR-CAT-03:** Published listings are searchable by keyword and filterable/sortable using indexed fields.
- **FR-CAT-04:** Buyers can post, pause and close requirements; matching is deterministic and explainable.
- **FR-CAT-05:** Uploads are size/type limited, renamed, scanned when supported, and served from object storage.
- **FR-CAT-06:** Seller can import bulk listings through CSV/XLSX using a published template. The service validates headers and each row, reports row-level errors without silently publishing bad data, and supports a review-before-publish step.

### Pools, orders and inventory

The following requirements describe the purchase workflow. Migrations 013/014 and the initial backend lifecycle APIs are implemented: direct order placement, group creation/join/leave and Seller decisions, reservations, pricing snapshots, idempotency, and deadline processing. Payment collection and the complete user-facing purchase journey remain unimplemented. See [Purchase Module](purchase-module.md).

- **FR-PUR-01:** A listing supports `direct`, `group`, or `both` purchase modes. The API enforces mode, MOQ (with an all-remaining-stock exception), available stock, group target, and price-tier rules on every request.
- **FR-PUR-02:** A direct order is reserved at placement and enters `pending_seller_confirmation`. Seller confirmation starts a 72-hour Buyer payment deadline; rejection or expiry releases the reservation.
- **FR-PUR-03:** Joining an open group reserves the Buyer quantity immediately. Contribution and inventory changes are atomic, idempotent, and concurrency safe. Buyers can leave only before Seller confirmation.
- **FR-PUR-04:** Group target cannot exceed available stock. Reaching the target makes the group ready for Seller confirmation. At the deadline, the Owner or Manager with `orders.confirm` chooses to expire it or confirm the full current contribution total as a smaller group; all current shares remain unchanged and included.
- **FR-PUR-05:** Seller confirmation snapshots the group participants and starts a 72-hour payment deadline per unpaid order. A nonpayer is removed and their quantity released. The group requires Seller reconfirmation before replacement participants are asked to pay; paid participants and their terms remain unchanged.
- **FR-PUR-06:** Direct order prices are snapshotted on placement; group participant prices are snapshotted at join using that Buyer's individual share quantity to select the tier. Listing price edits, later joins, and group confirmation do not reprice existing orders. The server calculates totals; clients cannot set price or lifecycle state.
- **FR-PUR-07:** Available stock equals physical stock minus active reservations and paid/committed quantities. Reservation creation, conversion, and release occur once under transaction/locking protection.
- **FR-PUR-08:** Direct order states include `pending_seller_confirmation`, `pending_payment`, `paid`, `rejected`, and `payment_expired`. Group contribution states and legal transitions follow the Purchase Module design. Each transition records actor, time, reason, prior state, and new state. Post-confirmation cancellation/refund behavior remains to be defined.
- **FR-PUR-09:** Payment attempts are separate from order state. Only a verified, idempotent provider result/callback can mark an order paid and create one ledger effect. The initial implementation uses a sandbox adapter until a live provider/settlement route is approved.
- **FR-PUR-10:** ReSource PK does not manage delivery or dispatch states.

### Payments and ledger

The following are planned requirements. The current backend has no checkout, provider integration, payment callbacks, or ledger.

- **FR-PAY-01:** Provider integration is behind a payment adapter; sandbox or simulator implements the same contract.
- **FR-PAY-02:** Server creates amount, currency, reference and signed request; client-supplied totals are ignored.
- **FR-PAY-03:** Callback signatures and provider references are verified before state changes.
- **FR-PAY-04:** Duplicate create/callback/refund requests are harmless through idempotency keys and unique constraints.
- **FR-PAY-05:** Append-only ledger records charge, contribution, platform fee, refund and adjustment entries whose debits/credits reconcile.
- **FR-PAY-06:** Provider secrets never reach browser code, logs or source control.

### Fulfilment, trust and impact

These are future product requirements. Delivery is outside ReSource PK's current scope; Buyer and Seller coordinate delivery externally. Buyer reviews of the Seller and material are planned after orders exist.

- **FR-TRUST-01:** Messaging, if shipped, is tied to a listing/order and subject to access checks.
- **FR-TRUST-02:** A completed transaction allows one buyer-to-seller and one seller-to-buyer review; moderation preserves history.
- **FR-PASS-01:** Create versioned canonical JSON from immutable completion fields and hash with SHA-256.
- **FR-PASS-02:** Queue Polygon anchoring and expose `pending`, `anchored`, or `failed`; retries must not create a second first-version record.
- **FR-PASS-03:** Public verification reveals no private buyer, seller, price, message, address, phone or email data.
- **FR-IMP-01:** Diversion quantity is derived from completed transactions, reversed for refunds/returns, and traceable to source orders.

### Reporting and analytics

- **FR-REP-01:** All dashboards support weekly, monthly, yearly and custom date ranges with an explicit timezone.
- **FR-REP-02:** Every headline metric links to filtered source records and displays its formula/definition.
- **FR-REP-03:** Authorized users can export the filtered dataset/report in CSV and PDF; exports are asynchronous for large ranges and audit logged.
- **FR-REP-04:** Owner dashboard includes GMV, seller proceeds, completed/refunded value, inventory value/ageing, MOQ/pool conversion, top materials/buyers, fulfilment SLA, impact and team activity.
- **FR-REP-05:** Manager dashboard includes operational queues, listings, pools, fulfilment, payment exceptions, inventory ageing and team workload; it excludes ownership-only finance/account controls unless permitted.
- **FR-REP-06:** Staff workspace shows assigned listings/orders/tasks, stock/reservation state and permitted operational progress; it excludes unrelated finance/team data.
- **FR-REP-07:** Buyer dashboard includes spending, active pools, contribution/payment status, order history, requirement matches and completed-purchase impact.
- **FR-REP-08:** Platform Admin dashboard includes marketplace health, active organizations/users, moderation/disputes, payment/anchor failures, GMV/platform fees where enabled, impact totals and audit/security events.

### Administration

- **FR-ADM-01:** Platform Admin can review users, organizations, listings, disputes and flagged reviews under explicit permissions.
- **FR-ADM-02:** Sensitive actions require reason capture and appear in immutable audit logs.
- **FR-ADM-03:** No UI-accessible role has unrestricted database access. Break-glass production access is time-bound and separately audited.

## Non-functional requirements

- **NFR-SEC:** OWASP-aligned validation, parameterized queries, secure headers, CSRF protection where cookie auth is used, least privilege, secret rotation, dependency scanning and audit logging.
- **NFR-PERF:** p95 cached/list reads under 500 ms and writes under 800 ms under agreed demo load, excluding external-provider latency.
- **NFR-REL:** Health/readiness endpoints, structured logs, correlation IDs, graceful shutdown, retry with backoff, and no blocking blockchain call in a user request.
- **NFR-DATA:** UTC timestamps, UUID identifiers, database constraints, migrations, daily managed backups, tested restore, retention policy, and soft deletion where auditability is required.
- **NFR-UX:** 100% responsive and tested at 360, 390, 768, 1024, 1280 and 1440+ px; keyboard accessible, WCAG 2.2 AA target, clear empty/loading/error/success states, and reduced-motion support.
- **NFR-VIS-01:** 3D/WebGL or canvas motion is progressively enhanced: it must have a static/reduced-motion fallback, lazy loading, mobile GPU budget, no layout shift and no effect on core commerce completion.
- **NFR-PRIV:** Data minimization, purpose limitation, masked admin displays, export/delete process, and no personal data on-chain.
- **NFR-MAINT:** Feature-based modules, OpenAPI contract, lint/format/test gates, ADRs for major decisions, and no business logic in controllers or React components.

## Core entities

`users`, `sessions`, `organizations`, `organization_memberships`, `invitations`, `permissions`, `listings`, `listing_images`, `price_tiers`, `requirements`, `matches`, `purchase_groups`, `orders`, immutable order price snapshots, `inventory_reservations`, `order_events`, `payment_attempts`, `payment_events`, `ledger_entries`, `disputes`, `reviews`, `passport_snapshots`, `blockchain_anchors`, `impact_events`, `notifications`, `audit_events`. This is the proposed logical model; migration-level names and constraints are specified by the Purchase Module design.

All mutable business tables include `created_at`, `updated_at`, and optimistic version or equivalent where concurrent updates matter. Tenant-owned rows include `organization_id` and are filtered in repository/service code plus database policy where supported.

## Acceptance scenarios

1. An expired or already-used invitation is rejected without creating membership.
2. A Manager without `can_invite_staff` cannot invite Staff or change Staff grants; Staff without `listings.view` or `listings.manage` cannot read private organization listings, and Staff cannot invite or grant permissions.
3. Two concurrent direct orders or group joins cannot over-reserve listing stock or exceed a group target.
4. Seller confirmation starts the payment window; payment before confirmation is rejected, and orders expire at 72 hours without timely payment.
5. A nonpayer's share reopens, requires group reconfirmation, and cannot cause paid participants to be charged or repriced.
6. Replaying a payment callback leaves one payment transition and one ledger effect.
7. A completed order cannot have passport source fields edited; return/refund creates linked events.
8. Changing a passport snapshot produces a mismatch against the on-chain hash.
9. An administrator cannot view another organization's private data without an authorized platform moderation workflow.

## Account transition and onboarding

Buyer and Seller use separate Google entry points that resolve to the same canonical user and Google identity. A Buyer can request Seller access with an organization name and retains Buyer access while the request is reviewed. A Reviewer granted `seller_requests.review` or a Platform Admin must approve the request before an organization and Owner membership are added to that same user. The backend enforces active organization membership and explicit platform grants. Owners invite Managers; Managers with `can_invite_staff` can invite Staff and grant listing permissions. Platform Admins are trusted developers/operators and invite Reviewers with selected grants. Invitations remain one-time, bound to the invited email, and expire after 72 hours.

## Catalog acceptance details — 11 October 2026

FR-CAT-01/02: owner/manager edits require draft/rejected state and current version; archive is terminal. Tiers increase from MOQ through available stock, with nonincreasing unit prices. Decimal text is validated exactly; API responses expose integer paisa as strings. Composition/color/location are optional, without invented values.

FR-CAT-03/04: discovery/detail/count/matching exclude inactive seller organizations. Matching uses the tier applicable to requested quantity, with an explicit separate MOQ result. Owned requirements can pause/resume and terminally close. Stale mutations return 409.

FR-CAT-05: up to eight JPEG/PNG/WebP images per listing; 5 MB, 16 megapixels, strict decode/re-encode, no animation/SVG; private WebP bucket and access-checked 60-second download URLs. No malware scanning service is configured; do not claim antivirus scanning.

FR-CAT-06: at most 100 data rows; XLSX first worksheet only, 2 MB input and 8 MB actual ZIP expansion. Reject encrypted/unsupported archives, forged sizes/CRC and duplicate entries; rebuild bounded archive before parsing. Imports create drafts, never publish automatically.

FR-AUTH-03/05/07/08: bind access JWT to a live session; enforce account status/verification every protected request. Logout/reset invalidate access immediately. Cookie mutation requires configured Origin plus custom header. Invitation acceptance rechecks current inviter grant authority and cannot replace an Owner. Password creation rejects more than 72 UTF-8 bytes to prevent bcrypt truncation.

## Week 2 acceptance clarification — 11 October 2026

Seller inventory, platform review and buyer requirement reads must be tenant/role scoped, deterministically ordered, and paginated with consistent counts. Public listing detail has a refreshable route, unavailable/loading/retry states and accessible tiers/metadata. Saved requirements support pause/resume and confirmed terminal close. Seller archive requires explicit confirmation. The mobile workspace drawer must trap focus, close on Escape, return focus and hide inactive controls. Image upload ambiguity must leave durable cleanup work, never silently discard recovery. See ADR 005 for the coordinated collection contract.

## FR-CAT-05 scheduled recovery acceptance — 11 October 2026

The image cleanup endpoint requires a separate scheduler secret, rejects anonymous/user credentials and unsafe methods, refuses unconfigured storage, and emits counts plus a correlation ID without secrets/object keys. Partial provider failures must return a failure status and leave work for a subsequent invocation. Record a real hosted invocation and verify linked listing images remain readable before closing T-102. Daily bounded cleanup is suitable for the current demo; it does not establish an unrestricted cleanup throughput SLA.
