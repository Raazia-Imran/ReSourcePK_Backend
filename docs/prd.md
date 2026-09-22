# Product Requirements Document

## Document control

- Product: **KapraLoop** (working name; repository names remain unchanged until brand clearance)
- Current name: ReSource PK
- Product type: Pakistan-focused circular B2B textile deadstock marketplace
- Release: MVP 1.0
- Delivery window: five weeks, three engineers
- Status: approved implementation baseline

## Product decision

KapraLoop enables textile suppliers to sell usable deadstock to small buyers who cannot meet industrial minimum-order quantities. Buyers may purchase directly or pool demand until a seller's minimum is reached. The MVP is a real, deployed, responsive web application, not a static demonstration.

## Users and value

| Actor | Need | Product value |
|---|---|---|
| Buyer | Affordable small quantities | Search, requirements, pooled orders, transparent contribution status |
| Seller organization | Recover value from deadstock | Listings, tiered pricing, order fulfilment, revenue and impact metrics |
| Organization owner | Delegate operations safely | Invite managers/staff and grant only necessary permissions |
| Platform operator | Keep the marketplace safe | Moderation, disputes, user/organization controls, audit trail |
| Public verifier | Check an impact record | Privacy-safe material passport verification |

## Goals and measurable outcomes

- A new buyer or seller can verify email, complete onboarding, and reach the correct workspace.
- A seller can publish a listing manually; bulk CSV/XLSX import is stretch scope.
- Buyers can search/filter, post a requirement, and receive deterministic matches.
- Multiple buyers can join one pool without overselling under concurrent requests.
- Each contribution has a server-calculated amount and idempotent payment state.
- A completed order creates an immutable passport snapshot and a Polygon Amoy hash.
- Every privileged action creates an auditable event.
- The production build passes responsive, accessibility, security, and end-to-end checks.

## MVP scope

### Must ship

1. Email verification, login, logout, reset password, session rotation, and role-aware onboarding.
2. Buyer profiles and seller organizations with membership invitations.
3. RBAC for Platform Admin, Organization Owner, Organization Admin, Manager, Staff, Buyer.
4. Listing CRUD, images, quantity, unit, condition, price tiers, moderation status, and validated bulk CSV/XLSX import with a downloadable template and row-level error report.
5. Search/filter/sort and buyer requirements with rules-based matching.
6. Direct orders only where the buyer purchases the full seller-permitted quantity/MOQ, plus group pools for sub-MOQ demand, reservations, expiry, contribution ledger, and atomic joins.
7. Payment-provider adapter with sandbox checkout, signed callbacks, idempotency, failure and refund simulation.
8. Order lifecycle, fulfilment confirmation, disputes, and verified-transaction ratings.
9. Material Passport snapshot, deterministic hash, asynchronous Polygon Amoy anchoring, and public verification page.
10. Role-aware Buyer, Seller Owner, Seller Manager, Seller Staff, and Platform Admin dashboards with drill-down reporting and export.
11. Impact measures calculated only from completed, non-reversed transactions.
12. Production deployment, monitoring, backups, migrations, seed data, and runbooks.

### Explicitly deferred

- Native mobile apps; the responsive PWA-ready web app is sufficient.
- Real-money settlement, escrow, payouts, tax invoicing, shipping-carrier integration, crypto payments.
- Custom-trained AI; use deterministic rules first and optional assisted tagging behind a feature flag.
- Microservices, multi-region infrastructure, and on-chain personal/commercial data.
- Super Admin as an unrestricted everyday account. Emergency access is a separately controlled break-glass procedure.

## Critical journeys

### Seller organization onboarding

The first verified registrant creates or claims an organization and becomes Organization Owner. The owner invites an Organization Admin or Manager by email. The invite is single-use, hashed at rest, role-scoped, expires, and is accepted only after the invited address is verified. Managers may invite Staff only when granted `members.invite`; they cannot grant permissions they do not hold.

### Group purchase

A buyer joins an open pool for a specific quantity. The server locks the pool row, validates availability and tier rules, records a reservation and contribution, then recalculates totals in one database transaction. Repeated requests with the same idempotency key return the original result. Expired reservations release inventory.

### Payment

The backend creates a payment attempt from server-priced order data. Browser redirects are never proof of payment. Only a verified, idempotent provider callback may advance payment state. Every transition is recorded in an append-only payment event log.

### Material Passport

After fulfilment is confirmed, the system freezes a versioned canonical snapshot, hashes it, queues an anchor job, and returns completion without waiting for the chain. Failures retry. The UI states exactly what verification proves: the snapshot has not changed since anchoring; it does not prove the original physical claim was true.

## Commerce rules

- Money is stored as integer minor units; quantities use fixed-precision decimals plus explicit units.
- Prices, discounts, fees, totals, gross merchandise value, seller proceeds, and refunds are calculated server-side.
- MVP platform revenue may be zero. If fees are demonstrated, they must use a versioned fee rule and a ledger entry; never infer profit from GMV.
- Margin definitions: gross margin = platform revenue minus directly attributable transaction costs; contribution margin additionally subtracts variable service costs. Seller product margin is not calculated without seller cost data.
- Orders and payments use state machines; clients cannot set lifecycle states directly.

## Purchase eligibility rules

1. A buyer may check out directly only when their requested quantity meets the listing MOQ or when the seller explicitly publishes a smaller direct-buy lot.
2. For a standard factory listing where the buyer's quantity is below MOQ, direct checkout is disabled and the UI offers Join a group purchase or Start a group purchase.
3. A buyer may purchase the entire available lot individually when it meets seller conditions.
4. Direct orders and group contributions have separate payment records and lifecycle states; both use the same secure payment adapter and ledger.
5. Sellers may choose whether a listing supports direct purchase, group purchase, or both. They may not bypass their stated MOQ after a buyer has reserved stock.

## Public landing experience

The public website explains the business before authentication: the deadstock problem, how ReSource PK works, group buying in three steps, measurable impact, trust/material passports, featured live listings, seller/buyer call-to-actions, FAQ and contact. It is a distinct marketing and discovery experience, but uses the same design system and codebase as the authenticated web app.

## Reporting and analytics

Reporting is a product capability, not generic dashboard decoration. Every authenticated role sees only numbers relevant to its authority, can select weekly/monthly/yearly/custom date ranges, drill into supporting records, and export CSV/PDF reports. All totals use server-defined calculations, visible definitions, timezone-aware periods and no invented estimates.

## UX direction

The visual language is a custom digital textile exchange: immersive editorial composition, layered/kinetic textile forms, purposeful 3D material objects, physical depth, sharp typography, and a distinctive palette chosen through a visual direction pass—not a default SaaS green dashboard. Motion reveals the value chain and supports comprehension; it never becomes noise. The landing page remains clean in its hero copy while its world feels alive. Desktop dashboards use a sidebar; mobile uses a drawer and task-priority actions. Every role uses one application shell with routed workspaces—not separate codebases or one oversized page.

## Release gates

- No critical/high security finding; no known authorization bypass.
- Tests cover auth, invitation expiry/reuse, role escalation, pool concurrency, payment callback replay, order transitions, and passport hashing.
- Core journey passes at 360 px, 768 px, 1024 px, and 1440 px.
- WCAG 2.2 AA checks for keyboard, focus, labels, contrast, errors, and reduced motion.
- Database migration and rollback tested; backups enabled and restore procedure documented.
- Demo data contains no real secrets or personal data.

## Naming decision

Recommended working name: **KapraLoop**. It is memorable, locally understandable, directly signals textiles plus circularity, and still sounds suitable for industry. This is a product recommendation, not trademark/domain clearance. Keep the current repository/package identifiers until legal, domain, social-handle, and stakeholder checks are completed.
