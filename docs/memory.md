# Project Memory and Decisions

This file records durable decisions so team members and coding assistants do not reopen settled questions without new evidence. It contains no secrets, credentials or personal data.

## Decisions — 16 October 2026

- Buyer and Seller use distinct Google sign-in entry points but share one canonical user and Google identity. A Buyer can request Seller access and keeps Buyer access; reviewer approval adds Seller organization membership to the same user.
- New Google accounts start with Buyer access. Seller permissions require an approved organization request. Managers/Staff and platform roles remain invitation/assignment based.
- Existing password accounts link Google only after authenticating to the account and proving the same verified email. Do not auto-link by email or create duplicate accounts.
- Google Identity Services ID tokens are verified by the backend against `GOOGLE_CLIENT_ID`; stable Google `sub` is stored in a private identity table. No client secret is needed for the ID-token flow.
- This checkout contains the backend endpoint and database migration. Frontend Google button/session integration and dashboard switching remain outstanding because the frontend repository is not present here.

## Decisions and implementation state — 17 October 2026

- The Buyer and Seller Google sign-in entry points stay separate, use the same canonical person and Google identity, and preserve Buyer capability after Seller approval. Seller entry submits an organization request; only approval creates Seller membership. The user can use both workspaces; a second Google account is not required.
- Platform Admins are trusted ReSource PK developers/operators. Admins invite Reviewers and grant only selected capabilities. Current grants are `seller_requests.review` and `listings.review`; wider platform activity/user/organization management grants remain future implementation. Admins retain both review capabilities.
- Owners invite Managers. A Manager can invite Staff when granted `can_invite_staff`; Owners and authorized Managers can grant Staff listing read/manage capabilities. Staff receive no listing access by default, and `listings.manage` includes view.
- Group ordering requires a listing configured for group/both. Buyers reserve shares on joining, may leave before confirmation, and lock their individual price then. Seller confirmation starts the 72-hour payment window; a nonpayer's share reopens and requires Seller reconfirmation. At deadline the Seller Owner or an authorized Manager chooses expiry or confirmation of all current shares as a smaller group. Escrow is not required for the initial flow. Delivery remains outside platform scope.
- Phase 3 includes direct purchases and group orders. Seller confirmation comes before payment; Buyers have 72 hours to pay. Group participant prices lock at join time; replacement participants get a new snapshot and the Seller reconfirms the revised group. A Manager needs the Owner-granted `orders.confirm` permission to make Seller order decisions; Staff receive no order access by default.
- Backend migrations 011/012 implement Staff listing grants and Reviewer invitations/grants; migrations 013/014 and purchase APIs implement the initial direct/group order lifecycle. Payment collection, delivery tracking, post-order reviews, and platform activity analytics remain unimplemented.

## Phase 3 purchase design — 17 October 2026

- Work sequence: proceed with Phase 3 purchase implementation before hosted deployment/Phase 1-2 provider verification. This does not close or waive the hosted gates; complete them after Phase 3 deployment and before production release.
- The detailed purchase requirements live in `purchase-module.md`; migrations 013/014 add the purchase schema and workflow support. Direct orders and group contribution/decision APIs, stock reservations, immutable price snapshots, deadline processing, and Owner-controlled Manager `orders.confirm` are implemented. Payment processing, gateway integration, refunds and settlement accounting remain unimplemented.
- Working design: direct and group orders reserve inventory transactionally; payment attempts are provider-independent and sandbox-first; order prices are immutable snapshots in paisa; successful payment converts a reservation to committed stock; idempotent callbacks create one ledger effect.
- Confirmed Chunk 1 choices: group tier uses each Buyer's individual share; Seller has 72 hours to accept/reject direct orders; Buyers may leave open groups before Seller confirmation. Payment will begin in the user-named Road/Raod gateway sandbox with JazzCash, Easypaisa, Raast, cards, and bank transfer as desired methods, pending exact provider/method confirmation.
- Seller confirms an under-target group by accepting all current shares unchanged or expiring the group. Decisions still needing product confirmation before affected implementation: exact sandbox provider and settlement route; post-confirmation/paid cancellation, refunds and restock; confirm round-half-up rounding before live payments.

## Current decisions

| ID    | Decision                                                                                                            | Reason                                                                                 | Status                              |
| ----- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| D-001 | Working product name remains ReSource PK; repository names stay ReSourcePK                                          | Clear textile/circular meaning; rename only after clearance                            | Proposed brand, fixed technical IDs |
| D-002 | Responsive web app first                                                                                            | One codebase fits five weeks and all target devices                                    | Accepted                            |
| D-003 | React SPA frontend                                                                                                  | Existing repository uses React 18                                                      | Accepted                            |
| D-004 | Node.js + Express backend                                                                                           | Existing implementation and planned JazzCash ecosystem; avoid dual backends            | Accepted                            |
| D-005 | Modular monolith                                                                                                    | Production discipline without microservice operational cost                            | Accepted                            |
| D-006 | PostgreSQL system of record                                                                                         | Transactions and relational consistency suit pools/orders/payments                     | Accepted                            |
| D-007 | One routed app with role-aware workspaces                                                                           | Shared identity/design, simpler deployment, server-side RBAC                           | Accepted                            |
| D-008 | Organization-scoped permission RBAC                                                                                 | Supports owner -> manager -> staff delegation safely                                   | Accepted                            |
| D-009 | No everyday Super Admin                                                                                             | Excess privilege; use narrow platform roles and audited break-glass access             | Accepted                            |
| D-010 | Rules-based matching first                                                                                          | Explainable and deliverable; optional AI behind adapter/flag                           | Accepted                            |
| D-011 | Buyer payment follows seller confirmation; no escrow in initial flow                                                | Keep payment simple while requiring confirmation before payment                        | Accepted; implementation future     |
| D-012 | Async, hash-only Polygon Amoy passport                                                                              | Keeps PII off-chain and user flow resilient                                            | Accepted                            |
| D-013 | Blockchain claim is tamper evidence, not truth proof                                                                | Accurate trust boundary                                                                | Accepted                            |
| D-014 | Impact derives from completed, non-reversed orders                                                                  | Prevents marketing totals from drifting from records                                   | Accepted                            |
| D-015 | Bulk CSV/XLSX import ships in MVP after manual listing                                                              | Factories commonly manage deadstock in spreadsheets; validation/review keeps data safe | Accepted                            |
| D-016 | Listings may enable group orders; target/deadline rules govern confirmation                                         | Allows small buyers to pool shares toward a mill's available quantity                  | Accepted; initial APIs implemented  |
| D-017 | Five role-aware dashboards in one web app                                                                           | Gives CEO, manager, staff, buyer and operator only their needed decisions/data         | Accepted                            |
| D-018 | Visual direction is immersive custom digital-textile design                                                         | User rejected generic SaaS/AI template styling; 3D is progressive enhancement          | Accepted                            |
| D-019 | Phase 3 includes direct and group purchases; Seller confirmation precedes payment; Buyer payment window is 72 hours | Ensures Seller approves each commitment and gives Buyers a clear deadline              | Accepted; initial APIs implemented  |
| D-020 | Group participant price locks at join; replacement groups require Seller reconfirmation after a nonpayer is removed | Prevents retroactive repricing and preserves Seller control over the changed group     | Accepted; initial APIs implemented  |

## Known constraints

- Three engineers and five weeks.
- Two existing repositories: React frontend and Express backend.
- Deployment must be public/hosted; localhost-only completion is unacceptable.
- Testnet/sandbox functionality must be visibly labeled.
- The brand requires legal/domain/social checks before public rename.

## Open decisions with deadlines

| Decision                                       | Owner            | Due                     | Default if unresolved                                                 |
| ---------------------------------------------- | ---------------- | ----------------------- | --------------------------------------------------------------------- |
| Managed PostgreSQL provider (Supabase vs Neon) | Integration lead | Resolved                | Supabase Postgres; keep the app schema private                        |
| Auth implementation (managed vs API-owned)     | Backend lead     | Resolved                | API-owned auth with Google Identity Services and app sessions         |
| Payment sandbox availability/credentials       | Integration lead | Day 3                   | Contract-compatible simulator; no false “real payment” claim          |
| Object storage provider                        | Backend lead     | Day 3                   | Supabase Storage or S3-compatible adapter                             |
| Final brand name                               | Product owner    | Before public marketing | Continue ReSource PK until the team approves a researched replacement |

## Change protocol

### 11 October 2026 — main consolidation

Only the user's onboarding/catalog work is retained in `main`. The user explicitly excludes the friend's `feature/correcting-database-schema` and `feature/some-minor-fixes` commits. The mistakenly introduced consolidation ancestry is replaced using a lease against the observed tip; a separate archive ref supports recovery and must not be merged back. No runtime or schema change is required for this correction. See `merge-reconciliation.md` for the source commits and resolution. Local preview instructions are in `local-preview-guide.md`. Live acceptance gates remain open.

Add a dated row describing what changed, why, affected requirements and migration consequence. Major architecture, security, data, provider or scope changes require an ADR and updates to PRD/SRS/tasks in the same pull request.

## 11 October 2026 — catalog completion slice

- User scope is their work only. Backend main was rebuilt with one user patch parent; friend additions from PRs 1/2 were excluded again. Keep recovery archive/old consolidation refs out of future merges. Historical PR merge labels are not ancestry evidence.
- Before new implementation: Week 2, with 5/37 existing checked tasks (13.5% checklist) and zero verified weekly release gates. Calendar elapsed time is not delivery progress.
- Catalog completion adds optional metadata, exact decimal/paisa handling, tiers, private normalized images, audited archive/review, version conflicts, requirement lifecycle, opt-in synthetic fixtures and CI. Old sessions need sign-in after deploying session-bound JWTs.
- Staging project was inactive and was restored; migrations 004/005 applied with the app ledger. No demo inventory was seeded into staging by this session. Security advisor returned no findings; missing import actor FK index was resolved. Unused-index INFO entries remain expected on an empty database and do not establish load readiness.
- The first real XLSX regression caught the v9 default reader returning worksheet objects. Import now uses its documented first-sheet reader and bounded archive sanitization.
- Hosted API/SMTP/storage, global abuse controls, mobile/desktop acceptance, production provisioning/step-up, load/concurrency scale and backup restore remain gates. Payments/pools/passports/analytics are not implemented. See verification guide and delivery status.

- Final automated evidence: backend 23 regression tests + 9 real PostgreSQL integration scenarios, migration replay, opt-in demo seed twice (4 suppliers/20 labelled listings/6 accounts), secret scan and production audit pass. Frontend lint/build/audit/secret scan pass. Checklist updated to 10/37 (27.0%); zero fully verified weekly release gates.

## 11 October 2026 — recovered handoff and CI quality-gate follow-up

- GitHub confirms backend PR #6 and frontend PR #4 were merged into `main` at 11:03 UTC. Backend friend branches still diverge: their one/two extra commits are not ancestors of the corrected main.
- The merged PR heads passed application CI and secret scans, but SonarCloud reported a C security rating for dependency installation with lifecycle hooks enabled. Do not describe those heads as having all checks green.
- Separate `fix/ci-dependency-scripts` branches disable hooks with `npm ci --ignore-scripts`; explicit lint/test/build steps remain. Verify Sharp image regression tests and the Vite production build from clean installs, then require the follow-up PR's CI and SonarCloud result before merge.
- This correction changes CI policy only. It does not add product scope, alter applied migrations or increase the 10/37 completion count. Hosted SMTP/storage, mobile/desktop journeys, load and recovery acceptance remain open.

## 11 October 2026 — remaining Week 2 implementation

- Restored root README links to the complete baseline and retained the required React/Express/PostgreSQL stack and SQL/service/adapter boundaries. No friend branches or recovery archives were merged.
- Added routed public detail and buyer/organization/platform workspaces, membership selection, paginated collection states, login deep-link restoration and refresh-aware CSV downloads. Mobile drawer behavior now matches the 1024 px breakpoint.
- Added durable image upload recovery before the storage boundary and safe cleanup grace/locking/retries. Staging `listing-images` bucket is private, WebP-only, 5 MB; no staging inventory or users were seeded/modified.
- Added isolated PostgreSQL regressions for pagination, image access/lifecycle and ambiguous storage timeout, plus browser acceptance across six required widths. Provider transport is simulated only inside explicit tests; it is not real Supabase roundtrip evidence.
- Vercel lookup returned 403 for the configured team. CLI/auth was unavailable. Backend storage/SMTP credentials were not available in this workspace and were not retrieved. Hosted deployment, real storage roundtrip, scheduled cleanup and Week 1 email acceptance remain open. See ADR 005 and delivery-status.md for exact evidence.

- Full dependency audit found a high-severity `braces` chain through development-only Nodemon. Removed Nodemon and retained hot reload using Node 24 native `--watch`; no new runtime package was needed. Production API URLs now require frontend deployment configuration; the localhost fallback is development-only.

## 11 October 2026 — final Week 2 automated acceptance

- Coordinated backend PR #8 and frontend PR #6 retain the user's original scope and exclude friend commits. All Week 2 implementation is present; hosted provider/deployment acceptance remains blocked.
- Final code evidence: 23 regression tests, 12 real PostgreSQL integration scenarios and eight Chromium browser scenarios passed. All six required widths passed the seller/reviewer/buyer lifecycle with focus/axe/overflow checks. CSV preview/import/edit, refresh-aware download, private drafts/archived detail and unsafe/unconfigured image states are covered. Mobile detail/requirements and desktop review screenshots were inspected.
- Browser checks caught low contrast in sidebar branding, welcome/metric/header text and decoration over text. Colors/layering were corrected without changing the chosen visual direction. Production endpoint fallback is now development-only.
- Backend Sonar: zero new issues/hotspots/duplication. Both full dependency audits, lint/format/build/secret scans pass. CI installs keep lifecycle hooks disabled, and the pinned browser CLI runs directly. The new API collections need coordinated frontend/backend deployment.
- T-103 is checked with scoped automated evidence; checklist is 11/37 (29.7%). T-102 remains partial solely for the real provider/hosted acceptance boundary. Zero fully verified weekly release gates: Vercel access 403, backend credentials/configuration, actual private-storage roundtrip, scheduled cleanup and Week 1 hosted Gmail acceptance remain open.

## 11 October 2026 — resumed in a small completion chunk

- Recovered clean `feature/week-2-acceptance` branches and existing backend PR #8/frontend PR #6. Exact previous heads passed final CI: backend `f0234e8` ([run 38141881887](https://github.com/Raazia-Imran/ReSourcePK_Backend/actions/runs/38141881887)); frontend `2b9d07e` ([run 38141843306](https://github.com/Raazia-Imran/ReSourcePK_Frontend/actions/runs/38141843306)). No completed browser implementation was repeated.
- Added the remaining host-side preparation: authenticated, uncached Vercel image-cleanup endpoint and daily cron definition using the existing locked/bounded service. Four regression scenarios cover missing/forged credentials, wrong methods/missing storage, successful counts/log redaction and partial/unexpected failure. Existing provider/database/browser evidence stays scoped; scheduler tests mock the worker and do not claim a live run.
- Rechecked the staging project: healthy, `listing-images` private/WebP-only/5 MB; security advisor returned no findings. No application users/inventory were changed. Vercel still returns 403 for `raazias-projects-142c0b42`, lists no accessible teams, and no authenticated local CLI or provider environment exists. Do not retrieve secrets to work around this.
- Remaining external action: restore intended-team Vercel access, configure backend database/JWT/Gmail/private storage/cron secrets directly in the host, review/deploy the paired PRs, and record the real provider roundtrip, hosted seller/reviewer/buyer flow and scheduled log. The verification guide provides the exact sequence. T-102 and hosted gates remain open; overall task count stays 11/37.
