# Project Memory and Decisions

This file records durable decisions so team members and coding assistants do not reopen settled questions without new evidence. It contains no secrets, credentials or personal data.

## Decisions — 16 October 2026

- One Google identity supports Buyer Mode and Seller Mode; switching dashboards does not remove either capability. The switch is UI context, never authorization.
- New Google accounts start with baseline Buyer access. Seller onboarding requires a separate organization workflow and Platform Reviewer approval. Managers/Staff and platform roles remain invitation/assignment based.
- Existing password accounts link Google only after authenticating to the account and proving the same verified email. Do not auto-link by email or create duplicate accounts.
- Google Identity Services ID tokens are verified by the backend against `GOOGLE_CLIENT_ID`; stable Google `sub` is stored in a private identity table. No client secret is needed for the ID-token flow.
- This checkout contains the backend endpoint and database migration. Frontend Google button/session integration and dashboard switching remain outstanding because the frontend repository is not present here.

## Current decisions

| ID    | Decision                                                                   | Reason                                                                                 | Status                              |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| D-001 | Working product name remains ReSource PK; repository names stay ReSourcePK | Clear textile/circular meaning; rename only after clearance                            | Proposed brand, fixed technical IDs |
| D-002 | Responsive web app first                                                   | One codebase fits five weeks and all target devices                                    | Accepted                            |
| D-003 | React SPA frontend                                                         | Existing repository uses React 18                                                      | Accepted                            |
| D-004 | Node.js + Express backend                                                  | Existing implementation and planned JazzCash ecosystem; avoid dual backends            | Accepted                            |
| D-005 | Modular monolith                                                           | Production discipline without microservice operational cost                            | Accepted                            |
| D-006 | PostgreSQL system of record                                                | Transactions and relational consistency suit pools/orders/payments                     | Accepted                            |
| D-007 | One routed app with role-aware workspaces                                  | Shared identity/design, simpler deployment, server-side RBAC                           | Accepted                            |
| D-008 | Organization-scoped permission RBAC                                        | Supports owner -> admin/manager -> staff delegation safely                             | Accepted                            |
| D-009 | No everyday Super Admin                                                    | Excess privilege; use narrow platform roles and audited break-glass access             | Accepted                            |
| D-010 | Rules-based matching first                                                 | Explainable and deliverable; optional AI behind adapter/flag                           | Accepted                            |
| D-011 | Sandbox/provider simulator for MVP payments                                | Real money, escrow and payouts need commercial/legal readiness                         | Accepted                            |
| D-012 | Async, hash-only Polygon Amoy passport                                     | Keeps PII off-chain and user flow resilient                                            | Accepted                            |
| D-013 | Blockchain claim is tamper evidence, not truth proof                       | Accurate trust boundary                                                                | Accepted                            |
| D-014 | Impact derives from completed, non-reversed orders                         | Prevents marketing totals from drifting from records                                   | Accepted                            |
| D-015 | Bulk CSV/XLSX import ships in MVP after manual listing                     | Factories commonly manage deadstock in spreadsheets; validation/review keeps data safe | Accepted                            |
| D-016 | MOQ controls direct buying; below-MOQ demand uses pools                    | Preserves the core deadstock problem and supports full-lot purchase when valid         | Accepted                            |
| D-017 | Five role-aware dashboards in one web app                                  | Gives CEO, manager, staff, buyer and operator only their needed decisions/data         | Accepted                            |
| D-018 | Visual direction is immersive custom digital-textile design                | User rejected generic SaaS/AI template styling; 3D is progressive enhancement          | Accepted                            |

## Known constraints

- Three engineers and five weeks.
- Two existing repositories: React frontend and Express backend.
- Deployment must be public/hosted; localhost-only completion is unacceptable.
- Testnet/sandbox functionality must be visibly labeled.
- The brand requires legal/domain/social checks before public rename.

## Open decisions with deadlines

| Decision                                       | Owner            | Due                     | Default if unresolved                                                 |
| ---------------------------------------------- | ---------------- | ----------------------- | --------------------------------------------------------------------- |
| Managed PostgreSQL provider (Supabase vs Neon) | Integration lead | Day 2                   | Supabase Postgres without exposing service key to client              |
| Auth implementation (managed vs API-owned)     | Backend lead     | Day 2                   | One system only; select after spike against invite/RBAC needs         |
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
