# ADR 005 — Week 2 routes, collections and upload recovery

Date: 11 October 2026. Status: accepted within the existing Week 2 scope.

## Decision

Keep React/Vite and the Express modular monolith. Add public marketplace/detail routes and role-scoped `/buyer/*`, `/org/:orgSlug/*` and `/admin/*` routes already required by the baseline. `/workspace` redirects using live account context. Select organizations from actual memberships. Refresh-protected deep links and CSV downloads use the existing session flow.

All seller inventory, review and buyer requirement collections return `data {items,total,page,limit}`. Validate page 1–200 and limit 1–50, default 20; count and records share a snapshot. This is a coordinated API/UI contract update: deploy both repositories together.

Persist an image recovery job before the provider upload. Lock the job during the listing transaction, remove it atomically with committed metadata, and retain it after ambiguous failures. The cleanup service skips fresh jobs for two minutes, uses locked batches of at most 20, preserves linked images and increments retries when storage fails. If a worker claimed an expired upload job, abort before uploading. Schedule the existing `npm run storage:cleanup` command in the deployment environment; a CLI implementation alone is not evidence of a running scheduler.

## Validation and limits

Use real API-owned sessions and isolated PostgreSQL for browser journeys at 360/390/768/1024/1280/1440 px. Axe scans cover machine-detectable WCAG A/AA issues; focus trapping, Escape, return focus and overflow checks cover the navigation drawer. Keep vendor transport simulations confined to explicit tests. No simulator enters production code.

The staging bucket is private, WebP-only and limited to 5 MB. Hosted acceptance still requires backend storage credentials, real upload/signed-read/delete verification, a scheduled cleanup job and coordinated Vercel deployment. The Vercel connector returned 403; hosted approval is not inferred from passing CI.

No applied migration changes, production fixtures or new runtime dependencies are introduced. The new pinned Playwright and axe dependencies are development-only (Apache-2.0 and MPL-2.0); lifecycle scripts remain disabled during dependency installation.

The auth limiter keeps its existing 12-request/15-minute default and becomes explicitly configurable through `AUTH_REQUESTS_PER_WINDOW` (3–1000). The isolated browser job uses 100 to accommodate repeated logins/refreshes across six widths; production configuration must retain an appropriate abuse-control budget. This is the same real middleware, not mock authentication.

## Deployment preparation follow-up — 11 October 2026

The CLI alone could not be invoked by the selected Vercel Functions host's native scheduler. Add a secret-authenticated GET endpoint that reuses the existing bounded cleanup service and declare a daily `0 3 * * *` cron. `CRON_SECRET` is optional for local catalog use, requires 32–256 characters when set, and is never exposed to the SPA. Requests fail closed without it. Missing storage and partial failures are errors; successful batches log counts/correlation ID without object keys or credentials. HEAD/POST are rejected. No migrations or runtime dependencies change.

Official references: [securing/managing jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [plan scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Hobby permits one daily execution with hour-level precision. Failed jobs are not automatically retried by Vercel: durable cleanup records are revisited on the next run or an authenticated manual retry. Deploy and inspect a real run before claiming the schedule is active.
