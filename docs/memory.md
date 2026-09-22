# Project Memory and Decisions

This file records durable decisions so team members and coding assistants do not reopen settled questions without new evidence. It contains no secrets, credentials or personal data.

## Current decisions

| ID | Decision | Reason | Status |
|---|---|---|---|
| D-001 | Working product name is KapraLoop; repository names stay ReSourcePK for now | Clear textile/circular meaning; rename only after clearance | Proposed brand, fixed technical IDs |
| D-002 | Responsive web app first | One codebase fits five weeks and all target devices | Accepted |
| D-003 | React SPA frontend | Existing repository uses React 18 | Accepted |
| D-004 | Node.js + Express backend | Existing implementation and planned JazzCash ecosystem; avoid dual backends | Accepted |
| D-005 | Modular monolith | Production discipline without microservice operational cost | Accepted |
| D-006 | PostgreSQL system of record | Transactions and relational consistency suit pools/orders/payments | Accepted |
| D-007 | One routed app with role-aware workspaces | Shared identity/design, simpler deployment, server-side RBAC | Accepted |
| D-008 | Organization-scoped permission RBAC | Supports owner -> admin/manager -> staff delegation safely | Accepted |
| D-009 | No everyday Super Admin | Excess privilege; use narrow platform roles and audited break-glass access | Accepted |
| D-010 | Rules-based matching first | Explainable and deliverable; optional AI behind adapter/flag | Accepted |
| D-011 | Sandbox/provider simulator for MVP payments | Real money, escrow and payouts need commercial/legal readiness | Accepted |
| D-012 | Async, hash-only Polygon Amoy passport | Keeps PII off-chain and user flow resilient | Accepted |
| D-013 | Blockchain claim is tamper evidence, not truth proof | Accurate trust boundary | Accepted |
| D-014 | Impact derives from completed, non-reversed orders | Prevents marketing totals from drifting from records | Accepted |

## Known constraints

- Three engineers and five weeks.
- Two existing repositories: React frontend and Express backend.
- Deployment must be public/hosted; localhost-only completion is unacceptable.
- Testnet/sandbox functionality must be visibly labeled.
- The brand requires legal/domain/social checks before public rename.

## Open decisions with deadlines

| Decision | Owner | Due | Default if unresolved |
|---|---|---|---|
| Managed PostgreSQL provider (Supabase vs Neon) | Integration lead | Day 2 | Supabase Postgres without exposing service key to client |
| Auth implementation (managed vs API-owned) | Backend lead | Day 2 | One system only; select after spike against invite/RBAC needs |
| Payment sandbox availability/credentials | Integration lead | Day 3 | Contract-compatible simulator; no false “real payment” claim |
| Object storage provider | Backend lead | Day 3 | Supabase Storage or S3-compatible adapter |
| Final brand name | Product owner | Before public marketing | Continue ReSource PK externally, KapraLoop only as working name |

## Change protocol

Add a dated row describing what changed, why, affected requirements and migration consequence. Major architecture, security, data, provider or scope changes require an ADR and updates to PRD/SRS/tasks in the same pull request.
