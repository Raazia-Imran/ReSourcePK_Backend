# ReSource PK Backend

Secure Express API for the ReSource PK circular textile marketplace.

For beginner clone, credential setup and feature checks, follow [the local preview guide](docs/local-preview-guide.md). Legacy branch reconciliation is recorded in [merge reconciliation](docs/merge-reconciliation.md).

## Required project baseline

Start with [the documentation index](docs/README.md), then read [PRD](docs/prd.md), [SRS](docs/srs.md), [architecture](docs/architecture.md), [design](docs/design.md), [engineering rules](docs/rules.md), [tasks](docs/tasks.md), [memory](docs/memory.md), and [analytics](docs/analytics.md). These documents govern scope, stack, permissions and acceptance; update every affected document with the code.

## Local setup

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Use the Supabase transaction-pooler PostgreSQL URL for `DATABASE_URL`.
3. Enable two-step verification on the Gmail account, create an app password, and set `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Never use the normal Gmail password.
4. Run `npm ci --ignore-scripts`, `npm run db:migrate`, then `npm run dev`.

## Checks

- `npm test`
- `npm run lint`
- `npm run format:check`

The API contract is in `docs/openapi.yaml`. Applied migrations are immutable; add a new numbered migration for every schema change.

## Current catalog verification

Read [Week 2 setup and verification](docs/verification-week-2.md), [delivery status](docs/delivery-status.md) and [catalog ADR 004](docs/adr/004-catalog-completion.md). This UI/API slice needs migrations 004–005 and coordinated deployment; previous sessions must sign in again. Image storage and synthetic seed are explicit optional configuration, not hardcoded data.

Latest scope and API/UI coordination: [Week 2 acceptance ADR 005](docs/adr/005-week-2-acceptance.md).
