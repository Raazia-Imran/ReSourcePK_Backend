# Product Requirements Document

> **Scope note (17 October 2026):** This is the target product specification, not a list of completed code. The backend's implemented features and agreed future work are tracked in [Current Features and Scope](current-features.md) and [Delivery Status](delivery-status.md). Phase 3 purchase decisions and proposed data model are in [Purchase Module](purchase-module.md).

## Document control

- Product: **ReSource PK** (working name; repository names remain unchanged until brand clearance)
- Current name: ReSource PK
- Product type: Pakistan-focused circular B2B textile deadstock marketplace
- Release: MVP 1.0
- Delivery window: five weeks, three engineers
- Status: approved implementation baseline

## Product decision

ReSource PK connects textile mills directly with small and home-based businesses seeking usable leftover material. Today, large textile firms often send leftover stock to physical wholesale markets such as Shershah, which can make suitable stock difficult for smaller businesses to access. ReSource PK's goal is to make this supply discoverable and purchasable directly. The backend now has initial group order APIs and inventory reservations; the complete frontend journey and payment flow remain unimplemented.

## Users and value

| Actor               | Need                         | Product value                                                          |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Buyer               | Affordable small quantities  | Search, requirements, pooled orders, transparent contribution status   |
| Seller organization | Recover value from deadstock | Listings, tiered pricing, order fulfilment, revenue and impact metrics |
| Organization owner  | Delegate operations safely   | Invite managers/staff and grant only necessary permissions             |
| Platform operator   | Keep the marketplace safe    | Moderation, disputes, user/organization controls, audit trail          |
| Public verifier     | Check an impact record       | Privacy-safe material passport verification                            |

## Goals and measurable outcomes

- A new buyer or seller can verify email, complete onboarding, and reach the correct workspace.
- A seller can publish a listing manually or through a validated bulk CSV/XLSX import.
- Buyers can search/filter, post a requirement, and receive deterministic matches.
- Multiple buyers can join one pool without overselling under concurrent requests.
- Each contribution has a server-calculated amount and idempotent payment state.
- A completed order creates an immutable passport snapshot and a Polygon Amoy hash.
- Every privileged action creates an auditable event.
- The production build passes responsive, accessibility, security, and end-to-end checks.

## MVP scope

### Must ship

1. Google Sign-In plus supported password authentication, secure account linking, logout, session rotation, and role-aware onboarding. Google addresses without a current Gmail or Workspace hosted-domain verification also complete ReSource PK email verification before account activation.
2. Buyer profiles and seller organizations with membership invitations.
3. RBAC for Platform Admin, Organization Owner, Manager, Staff, Buyer.
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
- Escrow, payouts, tax invoicing, shipping-carrier integration, and crypto payments. The planned initial group flow requires payment after seller confirmation but does not use escrow; checkout/payment implementation remains future work.
- Custom-trained AI; use deterministic rules first and optional assisted tagging behind a feature flag.
- Microservices, multi-region infrastructure, and on-chain personal/commercial data.
- Super Admin as an unrestricted everyday account. Emergency access is a separately controlled break-glass procedure.

## Critical journeys

### Seller organization onboarding

Platform approval creates the organization and its Owner membership. The Owner invites Managers or Staff by email. Invitations are single-use, hashed at rest, role-scoped, expire, and are accepted only by the invited email. Managers can invite Staff only when granted `can_invite_staff`. Owners and authorized Managers can grant Staff `listings.view` and/or `listings.manage`; Staff receive no organization listing access by default. `listings.manage` includes view access. Staff cannot invite or grant permissions. Order and payment permissions will be added with those workflows.

### Planned direct and group purchase

Phase 3 includes both direct orders and group orders. The Seller confirms either type before the Buyer is asked to pay; confirmed Buyers have 72 hours to pay. Direct orders reserve listing stock while awaiting Seller confirmation. Group contributions reserve quantity when the Buyer joins. Each group participant's price is locked at join time using their own share quantity to select the price tier. If a confirmed participant does not pay, their contribution is removed and the share reopens; a replacement group requires Seller reconfirmation. At the group deadline, the Seller Owner or an authorized Manager chooses to expire the group or confirm its smaller current total; confirmation includes all existing shares unchanged. Escrow is not part of the initial flow. Purchase workflows and RapidGateway hosted checkout with signed callbacks are implemented; refunds, settlement, and payouts remain future work. Detailed lifecycle, inventory, pricing, and data-model decisions are in [Purchase Module](purchase-module.md).

### Payment

The backend creates payment attempts from server-priced, immutable order snapshots. Browser redirects are never proof of payment. Only a verified, idempotent provider callback may advance payment state. RapidGateway hosted checkout uses TEST by default; LIVE mode requires merchant credentials and a separately registered signed webhook. Payment attempts and events are recorded once, with retries protected against duplicate effects. Refunds, settlement, and payouts are not implemented. No escrow is planned for the initial flow.

### Delivery boundary

Delivery is outside ReSource PK's current scope. Buyers and Sellers coordinate delivery themselves; the platform does not arrange or track shipping.

### Material Passport

After fulfilment is confirmed, the system freezes a versioned canonical snapshot, hashes it, queues an anchor job, and returns completion without waiting for the chain. Failures retry. The UI states exactly what verification proves: the snapshot has not changed since anchoring; it does not prove the original physical claim was true.

## Commerce rules

- Money is stored as integer minor units; quantities use fixed-precision decimals plus explicit units.
- Prices, discounts, fees, totals, gross merchandise value, seller proceeds, and refunds are calculated server-side.
- MVP platform revenue may be zero. If fees are demonstrated, they must use a versioned fee rule and a ledger entry; never infer profit from GMV.
- Margin definitions: gross margin = platform revenue minus directly attributable transaction costs; contribution margin additionally subtracts variable service costs. Seller product margin is not calculated without seller cost data.
- Orders and payments use state machines; clients cannot set lifecycle states directly.

## Purchase eligibility rules

Listings choose direct purchase, group ordering, or both. Direct order eligibility follows the listing MOQ and any Seller-enabled smaller direct-buy lot; group joins require group ordering to be enabled. The API calculates eligible quantity and price from current stock and listing tiers, reserves quantity transactionally, and returns the exact terms before commitment. Full rules and open decisions are in [Purchase Module](purchase-module.md).

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

Current working name: **ReSource PK**. The name is intentionally provisional and does not block implementation. Keep repository, package, database and deployment identifiers stable until the team approves a researched replacement and completes trademark, domain and social-handle checks.

## Account transition and onboarding

Buyer and Seller have separate Google sign-in entry points that resolve to the same canonical person/account. A person can enter through either path; an existing Buyer can apply to become a Seller without losing Buyer access. A Seller application collects the applicant name (prefilled from the Google profile and editable), CNIC number, company/mill name, contact number, and mill/business address. CNIC is encrypted at rest and exposed in full only to Reviewers granted `seller_requests.review` and Platform Admins; the applicant sees only its last four digits. A Reviewer granted `seller_requests.review` or a Platform Admin reviews the request; approval adds the seller organization and Owner membership to that account. Platform Admins are trusted ReSource PK developers/operators. They invite Reviewers and assign the implemented `seller_requests.review` and/or `listings.review` permissions. Broader Reviewer permissions for platform activity, user, and organization management remain future work. Direct organization creation cannot bypass review. The Owner invites Managers and grants their permissions; an authorized Manager may invite Staff and grant listing capabilities. Invitations remain one-time, bound to the invited email, and expire after 72 hours.

Existing password accounts link Google only after authenticating to that account, and only when the verified Google email matches. Google provider subject is the stable identity key; matching email alone does not silently merge accounts.

## Catalog delivery update — 11 October 2026

Week 2 includes optional composition/color/location, quantity tiers, private raster images, audited moderation, terminal archive, and requirement pause/resume/close. Demo inventory is opt-in and visibly synthetic; it is excluded from real metrics. Week 3 pools/payments and Week 4 passports/reports remain planned. Implementation and weekly release acceptance are tracked separately in `delivery-status.md`; mobile/desktop hosted acceptance is still required.

## Week 2 delivery clarification — 11 October 2026

Catalog completion includes refreshable public detail and role-scoped routes, paginated inventories/requirements/review, accessible mobile navigation and durable private-upload recovery. These finish existing Week 2 behavior without expanding into commerce. Synthetic seed data remains explicit and labelled. Real hosted storage and the coordinated seller → reviewer → buyer journey remain release criteria; local/CI evidence cannot sign off those provider/deployment boundaries.
