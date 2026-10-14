# Five Week Delivery Plan

## Working model

Three engineers own vertical feature slices. A rotating integration lead merges only reviewed, passing PRs. `main` stays deployable. Daily work starts from acceptance criteria and ends with an integrated demonstration, not isolated screenshots.

## Week 1 Foundation and identity

**Outcome:** verified user can sign in and reach the correct routed workspace against the deployed API/database.

- T-001 Protect branches, add PR template, CODEOWNERS, CI, lint/format/test/build.
- [x] T-002 Finalize OpenAPI conventions, error envelope, correlation IDs and health endpoints.
- T-003 Select managed PostgreSQL/auth/storage through time-boxed spikes; document ADRs.
- [x] T-004 Create initial migrations for users, sessions, organizations, memberships, invitations, permissions and audit events.
- [x] T-005 Implement verification, login/logout, reset, session rotation/revocation, rate limits.
- [x] T-006 Implement invitation acceptance and organization permission boundaries.
- [x] T-007 Build shared tokens/components, visual-direction prototype and routed shells for public landing, buyer, organization and platform admin.
- T-008 Deploy staging frontend/API/database and complete auth E2E test.

**Gate:** no mock auth; expired/reused invitation and forbidden-role tests pass.

## Week 2 Catalog and discovery

**Outcome:** authorized seller publishes stock; buyer finds it and posts a requirement.

- [x] T-101 Listing/image/price-tier migrations and policies.
- T-102 Listing CRUD, moderation states, secure upload adapter.
- [x] T-103 Catalog, detail, seller inventory, create/edit flows with all states.
- [x] T-104 Indexed keyword/filter/sort API with pagination.
- [x] T-105 Requirements and explainable rules-based matching.
- [x] T-106 Seed 4-5 suppliers and 20-25 realistic listings.
- [x] T-107 Build CSV/XLSX import: downloadable template, upload validation, row-level error report, review queue and safe publish.

**Gate:** seller-to-published-listing-to-search journey passes on mobile and desktop.

## Week 3 Pools, pricing and payments

**Outcome:** multiple buyers safely join a pool and complete sandbox contributions.

- T-201 Pool, contribution, reservation, order, payment event and ledger migrations.
- T-202 Versioned pricing engine with boundary/unit tests.
- T-203 Atomic/idempotent join flow with concurrency and expiry tests.
- T-204 Pool UI with target, tiers, countdown, reservation/payment states.
- T-205 Payment adapter, signed request/callback validation, replay protection and simulator fallback.
- T-206 Direct checkout eligibility based on MOQ/full-lot/seller rules, group contribution UI, separate payment lifecycles, refund/cancel paths and reconciliation job.
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
- T-308 Implement role-aware report centre, metric definitions, drill-down views and CSV/PDF exports.

**Gate:** payment -> fulfilment -> passport -> verification journey works; deliberate DB alteration causes mismatch.

## Week 5 hardening and release

**Outcome:** reproducible production deployment and reliable live demonstration.

- T-401 Threat-model review, dependency/secret scan and authorization matrix test.
- T-402 Full E2E matrix across buyer, owner, manager, staff and platform roles.
- T-403 Accessibility, 360/390/768/1024/1280/1440+ responsive, slow-network and browser checks; validate static/reduced-motion fallbacks for all 3D/motion layers.
- T-404 Load/concurrency tests for search, pool joins and callback bursts.
- T-405 Migration/rollback, backup restore, worker retry and provider outage drills.
- T-406 Production deployment, observability, alerts, privacy-safe demo data and smoke test.
- T-407 README/runbook/API docs/demo script and known-limitations statement.

**Gate:** all PRD release gates pass and the demo can be run from a clean account without manual database edits.

## Priority if time compresses

Never cut auth security, tenant isolation, pool concurrency, payment idempotency, data integrity, accessibility basics or deployment. Cut in this order: custom AI, SMS, chat, bulk import, decorative animation, advanced analytics. A smaller honest system is acceptable; a falsely “complete” unsafe system is not.

## Evidence snapshot — 11 October 2026

All seven Week 2 tasks have implementation in the coordinated PRs; six have scoped automated acceptance evidence. T-102 remains partial for the real private-storage provider roundtrip and hosted configuration. T-103 is now checked after routed detail/inventory/review/requirement screens passed real-session Chromium/PostgreSQL journeys at 360/390/768/1024/1280/1440 px, with keyboard, axe and overflow checks. Eight browser scenarios include CSV validation/import, session-refresh download, private draft/archive visibility and actual unconfigured/unsafe image failures.

Eleven of 37 implementation tasks are checked (29.7%, unweighted checklist completion). Backend CI passes 23 regression tests and 12 real PostgreSQL integration scenarios, seed replay, full dependency audit and secret checks; frontend lint/format/build/full audit/secret checks pass. Backend Sonar reports zero new issues. These are scoped checks, not a weekly release sign-off. Week 1 hosted identity and Week 2 hosted storage/deployment/cleanup gates remain open; see `delivery-status.md`.

## Completion checkpoint — 11 October 2026

T-102 now also includes the authenticated Vercel cleanup endpoint and daily schedule definition; four scheduler regression scenarios supplement the catalog suite. Hosted acceptance is still partial: credentials/team access, actual private upload/read/delete, a hosted seller/reviewer/buyer journey and an observed scheduled run must pass. Do not check the task or start Week 3 merely because the definition and isolated tests exist. Follow the final hosted steps in `verification-week-2.md`.
