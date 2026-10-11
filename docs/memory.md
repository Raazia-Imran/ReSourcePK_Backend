# Project Memory and Decisions

This file records durable decisions so team members and coding assistants do not reopen settled questions without new evidence. It contains no secrets, credentials or personal data.

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
