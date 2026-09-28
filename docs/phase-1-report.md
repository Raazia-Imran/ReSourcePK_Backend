# Phase 1 Foundation Report

**Date:** 22 September 2026  
**Working product name:** ReSource PK  
**Delivery state:** implementation and staging database complete; hosted runtime configuration pending

## Delivered

### Product experience

- Responsive public landing page with a custom dimensional textile visual language.
- Buyer and Seller registration, login, verification, forgotten-password and reset-password screens.
- One application shell with role-aware Buyer, Organization and Platform views. Organization data supports distinct Owner, Organization Admin, Manager and Staff permissions.
- Secure organization invitation acceptance for new and existing users.
- Real empty states in dashboards. Metrics are never invented; role-specific weekly, monthly, yearly and custom reports remain scheduled for the analytics phase.

### API and security

- Versioned Express API, correlation IDs, stable error envelope, health/readiness endpoints, strict CORS, security headers and rate limits.
- Passwords hashed with bcrypt at cost 12. Refresh tokens and email/invitation tokens are random and stored only as SHA-256 hashes.
- Short-lived access JWTs plus rotating, revocable HttpOnly refresh sessions.
- Single-use verification, password-reset and organization-invitation links with expiry.
- Gmail SMTP adapter through Nodemailer using `GMAIL_USER` and `GMAIL_APP_PASSWORD`; accessible HTML and plain-text templates; idempotent delivery records.
- OpenAPI contract at `docs/openapi.yaml`.

### Database

- Supabase project: `ReSourcePK-Staging` in `ap-south-1` on the free plan.
- Private `app` schema with users, sessions, tokens, organizations, memberships, invitations, platform assignments, email deliveries and audit events.
- `anon` and `authenticated` roles have no schema usage. Supabase security advisor returns no findings after hardening.
- Required foreign-key and query indexes are installed. The remaining “unused index” notices are expected for a new empty database.

## Portal model

There is one responsive website and one login, with five dashboard experiences selected by server-authorized context:

| Experience         | Who uses it                       | Phase 1 result                                       |
| ------------------ | --------------------------------- | ---------------------------------------------------- |
| Buyer              | individual buyer or microbusiness | protected shell and procurement navigation           |
| Seller Owner / CEO | organization creator              | organization shell and full team delegation boundary |
| Seller Manager     | delegated operations lead         | organization shell with lower role boundary          |
| Seller Staff       | invited employee                  | organization shell for assigned operations           |
| Platform Admin     | ReSource PK operations            | separate platform navigation and role data           |

The Owner invites an Admin or Manager by email. A Manager can invite Staff only when `can_invite_staff` is granted. Invite tokens expire after 72 hours, work once, and must match the invited email. The API enforces access; hiding a menu item is never treated as security.

## What each teammate does next

| Owner             | Immediate work                                                           | Week 2 continuation                                        |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Backend / data    | add Vercel and Supabase connection secrets; run hosted auth smoke test   | listings, media, search, CSV/XLSX import validation        |
| Frontend / design | review landing at 360, 768, 1024 and 1440 px; approve visual direction   | marketplace, listing and import-review interfaces          |
| Integration / QA  | configure Gmail app password; test buyer, seller and invitation journeys | API contract tests, deployment checks, realistic demo data |

## Does a teammate still need to design the database schema?

No. The Phase 1 schema is designed, migrated to staging and advisor-checked. A teammate should review migrations through the pull request and add future business tables only through new numbered migrations. Nobody should recreate these tables manually in the Supabase dashboard or edit an applied migration.

## Configuration still required

No secrets are committed. The deployment owner must add `DATABASE_URL`, `JWT_ACCESS_SECRET`, `APP_URL`, `CORS_ORIGINS`, `GMAIL_USER`, and `GMAIL_APP_PASSWORD` to the backend environment, plus `VITE_API_URL` to the frontend. Gmail requires two-step verification and an app password. Vercel deployment also requires the connected Vercel integration to be authorized for the `raazias-projects-142c0b42` scope.

## Verification evidence

- Backend lint passed.
- Backend security/foundation tests: 3 passed.
- Frontend optimized production build passed.
- Production dependency audits return zero known vulnerabilities in both repositories.
- Local development server compiled and served the application shell.
- Supabase migrations applied successfully; nine tables verified; security advisor clean.

Browser screenshot automation could not start its Chromium daemon in the execution environment. The production build and HTTP serving checks passed; the device-width visual review remains an explicit hosted smoke test rather than a claimed pass.
