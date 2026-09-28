# ReSource PK Backend

Secure Express API for the ReSource PK circular textile marketplace.

## Local setup

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Use the Supabase transaction-pooler PostgreSQL URL for `DATABASE_URL`.
3. Enable two-step verification on the Gmail account, create an app password, and set `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Never use the normal Gmail password.
4. Run `npm ci`, `npm run db:migrate`, then `npm run dev`.

## Checks

- `npm test`
- `npm run lint`
- `npm run format:check`

The API contract is in `docs/openapi.yaml`. Applied migrations are immutable; add a new numbered migration for every schema change.
