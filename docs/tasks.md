# Five Week Delivery Plan

## Working model

Three engineers own vertical feature slices. A rotating integration lead merges only reviewed, passing PRs. `main` stays deployable. Daily work starts from acceptance criteria and ends with an integrated demonstration, not isolated screenshots.

## Week 1 Foundation and identity

**Outcome:** verified user can sign in and reach the correct routed workspace against the deployed API/database.

- T-001 Protect branches, add PR template, CODEOWNERS, CI, lint/format/test/build.
- T-002 Finalize OpenAPI conventions, error envelope, correlation IDs and health endpoints.
- T-003 Select managed PostgreSQL/auth/storage through time-boxed spikes; document ADRs.
- T-004 Create initial migrations for users, sessions, organizations, memberships, invitations, permissions and audit events.
- T-005 Implement verification, login/logout, reset, session rotation/revocation, rate limits.
- T-006 Implement invitation acceptance and organization permission middleware with escalation tests.
- T-007 Build shared tokens/components and routed shells for marketplace, buyer, organization and platform admin.
- T-008 Deploy staging frontend/API/database and complete auth E2E test.

**Gate:** no mock auth; expired/reused invitation and forbidden-role tests pass.

## Week 2 Catalog and discovery

**Outcome:** authorized seller publishes stock; buyer finds it and posts a requirement.

- T-101 Listing/image/price-tier migrations and policies.
- T-102 Listing CRUD, moderation states, secure upload adapter.
- T-103 Catalog, detail, seller inventory, create/edit flows with all states.
- T-104 Indexed keyword/filter/sort API with pagination.
- T-105 Requirements and explainable rules-based matching.
- T-106 Seed 4-5 suppliers and 20-25 realistic listings.
- T-107 Optional bulk CSV/XLSX import only after the primary flow passes.

**Gate:** seller-to-published-listing-to-search journey passes on mobile and desktop.

## Week 3 Pools, pricing and payments

**Outcome:** multiple buyers safely join a pool and complete sandbox contributions.

- T-201 Pool, contribution, reservation, order, payment event and ledger migrations.
- T-202 Versioned pricing engine with boundary/unit tests.
- T-203 Atomic/idempotent join flow with concurrency and expiry tests.
- T-204 Pool UI with target, tiers, countdown, reservation/payment states.
- T-205 Payment adapter, signed request/callback validation, replay protection and simulator fallback.
- T-206 Checkout/contribution UI; refund/cancel paths and reconciliation job.
- T-207 Security review of amounts, callbacks, secrets and authorization.

**Gate:** parallel test cannot overfill; callback replay has one financial effect; ledger reconciles.

## Week 4 Fulfilment, trust, administration and passport

**Outcome:** an order completes, is reviewed, moderated and independently hash-verified.

- T-301 Order state machine, fulfilment confirmation, cancellation/refund/dispute events.
- T-302 Verified-transaction ratings and minimal order-linked messaging if capacity remains.
- T-303 Platform moderation queues and permission-scoped admin tools.
- T-304 Canonical passport serializer, hash vectors and immutable snapshot.
- T-305 Outbox/worker, Polygon Amoy contract with first-write protection, retry/verification API.
- T-306 Public verification UI with accurate claim wording.
- T-307 Impact event derivation and buyer/seller/admin dashboard metrics.

**Gate:** payment -> fulfilment -> passport -> verification journey works; deliberate DB alteration causes mismatch.

## Week 5 hardening and release

**Outcome:** reproducible production deployment and reliable live demonstration.

- T-401 Threat-model review, dependency/secret scan and authorization matrix test.
- T-402 Full E2E matrix across buyer, owner, manager, staff and platform roles.
- T-403 Accessibility, 360/768/1024/1440 responsive, slow-network and browser checks.
- T-404 Load/concurrency tests for search, pool joins and callback bursts.
- T-405 Migration/rollback, backup restore, worker retry and provider outage drills.
- T-406 Production deployment, observability, alerts, privacy-safe demo data and smoke test.
- T-407 README/runbook/API docs/demo script and known-limitations statement.

**Gate:** all PRD release gates pass and the demo can be run from a clean account without manual database edits.

## Priority if time compresses

Never cut auth security, tenant isolation, pool concurrency, payment idempotency, data integrity, accessibility basics or deployment. Cut in this order: custom AI, SMS, chat, bulk import, decorative animation, advanced analytics. A smaller honest system is acceptable; a falsely “complete” unsafe system is not.
