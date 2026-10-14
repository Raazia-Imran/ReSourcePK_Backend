# Week 2: beginner setup and verification

Read the existing [local preview guide](local-preview-guide.md) first. This guide adds the new catalog, security, image and demo checks. [Delivery status](delivery-status.md) explains the current phase and remaining work.

## 1. Start from the correct code

Use a new folder if you have local edits or an old checkout. Backend history was corrected to exclude the two unwanted friend additions. Do not merge the recovery archive or old consolidation branch.

```bash
git clone https://github.com/Raazia-Imran/ReSourcePK_Backend.git ReSourcePK_Backend_preview
git clone https://github.com/Raazia-Imran/ReSourcePK_Frontend.git ReSourcePK_Frontend_preview
```

If this slice is still an open PR, use `git switch feature/week-2-acceptance` inside each clone. Once merged, fresh clones use `main`.

Open both folders in VS Code. Install Node.js 24. Open two terminal windows: one for backend, one for frontend. Do not paste a password into a GitHub commit or public issue.

## 2. Understand the passwords and keys

| Setting/account              | Where it comes from                                                      | Where to put it                                                            |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Application login            | Your own signup password; invitation users choose theirs                 | Sign-in form only; database stores a bcrypt hash, never readable passwords |
| PostgreSQL database password | Your Supabase project database password, separate from application login | Backend `.env`, inside `DATABASE_URL`; use the provider Connect dialog     |
| JWT secret                   | Generate locally with the command below                                  | Backend `.env` only                                                        |
| Gmail app password           | Google account with two-step verification → app passwords                | Backend `GMAIL_APP_PASSWORD`; not your ordinary Gmail password             |
| Storage service credential   | Supabase project API settings, server/service credential                 | Backend `SUPABASE_SERVICE_ROLE_KEY` only; never a `VITE_` variable         |
| Demo logins                  | Opt-in seed below; you supply the password                               | Use your chosen `DEMO_PASSWORD` for those accounts                         |
| GitHub account               | The account authorized for these repositories                            | GitHub connection; unrelated to marketplace login                          |

There is no shared/default real Owner, Buyer or Platform Admin password. Existing application passwords cannot be recovered; use the reset email. Connecting GitHub does not create an application login.

Generate a JWT secret in your backend terminal:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Copy the printed value into your private backend `.env`. Do not post it in chat or commit it.

## 3. Configure and start the backend

1. Copy `.env.example` to `.env` using VS Code. Keep `NODE_ENV=development`, port 5000, and direct-local `TRUST_PROXY_HOPS=0`.
2. Fill `DATABASE_URL` from your selected Supabase project's Connect dialog. Use its pooler connection, database username, real database password and required TLS setting. Percent-encode reserved characters in URL credentials.
3. Fill the generated `JWT_ACCESS_SECRET`. Keep `APP_URL` and `CORS_ORIGINS` at `http://localhost:3000` for local testing. Allowed origins are exact; `localhost` and `127.0.0.1` differ.
4. Uncomment and fill both Gmail variables to test real signup verification/invitations. Remove spaces from the Google app password. Missing email credentials do not create a verified real account.
5. Run:

```bash
cd ReSourcePK_Backend_preview
npm ci --ignore-scripts
npm run db:migrate
npm run lint
npm test
npm run dev
```

For the connected staging project, migrations 001–005 were applied and recorded. `db:migrate` skips recorded files. Other databases need the migration command. Do not edit applied SQL or manually mark an unapplied migration as applied.

Visit `http://localhost:5000/health` and `/ready`. Both should succeed; `/ready` requires a database connection.

## 4. Start the frontend

In the second terminal:

```bash
cd ReSourcePK_Frontend_preview
npm ci --ignore-scripts
```

Create frontend `.env` from `.env.example`. Its API setting is:

```dotenv
VITE_API_URL=http://localhost:5000/api/v1
```

Run `npm run dev`, then visit `http://localhost:3000`. Sign in again after this API update: old access tokens lack the required session ID. Refresh/logout now use the trusted Origin and custom header automatically through the frontend.

## 5. See tables and optional demo inventory

In Supabase, open the **same project referenced by your backend connection**, then Table Editor → schema selector → **app**. Application users live in `app.users`, not Supabase Auth. An empty `public` schema does not mean application tables are missing.

SQL Editor inspection:

```sql
select name, applied_at from app.schema_migrations order by name;
select table_name from information_schema.tables
where table_schema = 'app' order by table_name;
select id, title, status, is_demo from app.listings;
```

Staging was restored from an inactive state during this work. It has the schema; this session did not seed inventory there. Public catalog is intentionally empty until listings are published or you explicitly seed a development database.

To populate a **dedicated non-production database**, stop the backend, then edit private backend `.env`: set `ALLOW_DEMO_SEED=true` and set `DEMO_PASSWORD` to a strong password you choose (10–72 UTF-8 bytes, uppercase/lowercase/digit). Run:

```bash
npm run db:seed:demo
```

This creates four synthetic suppliers, twenty visibly labelled published listings, and these accounts:

- `demo-buyer@resourcepk.example.invalid`
- `demo-admin@resourcepk.example.invalid`
- `demo-owner-1@resourcepk.example.invalid` through `demo-owner-4@resourcepk.example.invalid`

Their password is the one **you supplied when they were first created**. Rerunning preserves them; changing the environment does not reset old passwords. No verification emails are sent for fixtures. Remove the demo settings when done and restart the backend. Production seeding is refused. Do not treat demo suppliers/prices as real offers or demo stock as verified impact.

## 6. Enable listing images

Images are optional configuration; text catalog works without storage. Unconfigured uploads return an explicit 503, not fake success.

1. In backend `.env`, set all three: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LISTING_IMAGE_BUCKET` (for example, `listing-images`).
2. Run `npm run storage:setup`. It creates a private bucket restricted to WebP and 5 MB, or checks an existing compatible bucket. Do not make it public or add browser upload/read policies.
3. Restart the backend. Owner/Manager → seller draft card → **Manage listing images** → choose JPEG/PNG/WebP and write an image description → **Upload image**.
4. Expect up to eight images per listing, 5 MB per file and 16 megapixels. SVG, animated/corrupt images and oversize input must fail. Stored output is resized WebP without metadata.
5. Image removal queues the object for cleanup. Run `npm run storage:cleanup` to process up to twenty jobs older than two minutes; failed jobs remain retryable. Pre-upload recovery survives provider timeouts; locked jobs prevent cleanup racing a live upload. Schedule this command on your hosting worker before production.

## 7. Verify the features in the browser

| Journey       | Steps                                                                                                             | Expected result                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Seller draft  | Sign in as Owner; create a draft, fill optional metadata, add increasing tier thresholds and nonincreasing prices | Draft appears only in seller inventory                                                          |
| Edit conflict | Open the same draft in two tabs; save in one, then save stale version in the other                                | Second save receives 409; reload and edit current stock                                         |
| Images        | Upload allowed raster with description; try SVG and corrupt file                                                  | Real image appears; unsafe files are rejected                                                   |
| Moderation    | Submit draft; sign in as demo reviewer or provisioned Platform Admin; write reason; publish or reject             | Pending stock is private; published stock enters discovery; rejection note is visible to seller |
| Discovery     | Search keyword/material, sort price, move between pages                                                           | Only published stock from active organizations; metadata and tier table come from API           |
| Requirement   | Buyer posts matching material/unit/quantity; view matches; pause; resume; close                                   | Tier-aware price explanation; pause hides matching; closed cannot reopen                        |
| Archive       | Seller card → archive section → confirm archive                                                                   | Stock disappears from public search/detail/matches; audit/history remains                       |
| Factory sheet | Download template; put data on first worksheet; upload CSV/XLSX; fix row errors; confirm import                   | Drafts only; up to 100 rows/2 MB; reusing same key does not duplicate stock                     |
| Role boundary | Use Staff or another organization's account to attempt seller operation                                           | 403; changing organization IDs does not grant access                                            |
| Logout/reset  | Keep a protected page open, logout or reset password, retry old session                                           | Old access is rejected; sign in again                                                           |

Use separate browser profiles for Buyer, Seller and Reviewer. Check 360, 390, 768, 1024, 1280 and 1440 px; keyboard focus, image descriptions, zoom, errors and reduced motion. Record failures instead of considering a build proof of visual acceptance.

## 8. Check CI, security and remaining work

GitHub → Actions → latest **CI**. Backend runs formatting/lint, 23 regression tests, 12 real isolated PostgreSQL integration scenarios, demo seed replay and production dependency audit. Both repositories run secret scans; frontend runs lint/format/build/audit. The backend browser job uses real sessions/PostgreSQL and Chromium at six required widths, with automated accessibility/focus/overflow checks. Passing CI does not verify hosted Gmail, private storage or hosted mobile browsing.

Database integration tests require a separate local `resourcepk_test_*` PostgreSQL database and `TEST_DATABASE_URL`. They refuse project URLs. Run `node scripts/prepare-test-db.js`, then `npm run test:integration`. Never replace the safety check to point at staging/production.

GitHub main protection still requires repository admin settings: require PRs and the named CI/secret jobs before merge; disallow force pushes/deletion. The connector cannot administer that setting. For a sole owner, choose a review rule you can actually satisfy; do not merge someone else's branch to satisfy a count.

Before Week 3: hosted signup/invite tests, real image roundtrip, seller→reviewer→buyer journey on mobile/desktop, scheduled cleanup and documented platform provisioning. Later: pools/payments/ledger (Week 3), fulfilment/passports/analytics/reports (Week 4), and load/accessibility/recovery/release checks (Week 5). See `delivery-status.md` for task-by-task evidence.

## 9. Run isolated browser acceptance

The backend CI `week2-browser` job checks out a pinned, reviewed frontend revision. `E2E_FRONTEND_REF` may explicitly select another reviewed commit; update the pin when coordinating a later frontend change. It creates only synthetic accounts in its disposable `resourcepk_test_e2e` database. It does not use project credentials or real Gmail/storage.

Locally, clone both repos side by side, create a dedicated local `resourcepk_test_e2e` PostgreSQL database, and set `TEST_DATABASE_URL`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `E2E_PASSWORD`, `DEMO_PASSWORD` (same chosen password), `ALLOW_DEMO_SEED=true`, `NODE_ENV=test`. Then:

```bash
# Backend terminal
npm ci --ignore-scripts
node scripts/prepare-test-db.js
npm run db:seed:demo
node node_modules/@playwright/test/cli.js install --with-deps chromium
# Frontend terminal: set VITE_API_URL=http://localhost:5000/api/v1
npm ci --ignore-scripts
npm run build
# Backend terminal
npm run test:e2e
```

Use `E2E_FRONTEND_DIR` when the frontend is not the sibling `frontend` folder. The test starts/stops both servers and refuses a nonlocal/non-test database. Screenshots use synthetic data; auth traces are disabled. Eight browser scenarios include CSV import/edit, refreshed template download, unsafe/unconfigured image errors and draft/archive privacy. The six widths exercise draft creation with price tiers, review, public detail/reload, buyer matches, pause/resume/close and archive. A separate test injects a clearly simulated transport outage to verify retry and empty states. Automated axe checks do not establish a complete accessibility audit or hosted-storage readiness.

## Hosted boundary still awaiting acceptance

The connected staging `listing-images` bucket is private, limited to WebP and 5 MB. Configure the three storage variables in the backend host directly, restore Vercel team access (the connector returned 403), deploy the coordinated branches after review, then perform the real upload/signed read/delete and schedule/monitor cleanup. Configure Gmail for clean-account signup/invitation verification. Never place service credentials in frontend variables or commit them.

For the repeated local browser suite set `AUTH_REQUESTS_PER_WINDOW=100`; normal application use retains the default 12 requests per 15 minutes. CI uses this isolated test budget without changing production values.

## Final hosted completion steps (remaining blocker)

The code and isolated API/browser checks are present in backend PR #8 and frontend PR #6. This sequence finishes the real provider/deployment gate; it never requires posting secrets in chat.

1. In the Vercel account used by the connector, confirm access to `raazias-projects-142c0b42` and the two ReSource PK projects. The current connector returns 403 and lists no accessible teams. Fix the account/team permissions or reconnect the correct account; the error does not prove reconnecting alone will fix it. No alternative team/project should be selected automatically.
2. Review the coordinated PRs. Deploy their matching backend and frontend revisions together because protected collections return `{items,total,page,limit}`. Keep migrations 001–005 intact; use the documented migration command if the target host's database needs them. Do not merge friend/archive branches.
3. In the **backend project → Settings → Environment Variables**, configure the selected environment directly. Secrets: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `GMAIL_APP_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Configuration: `APP_URL`, `CORS_ORIGINS`, `GMAIL_USER`, `SUPABASE_URL`, `LISTING_IMAGE_BUCKET=listing-images`, `TRUST_PROXY_HOPS` appropriate to the host and `DATABASE_POOL_MAX`. Use the selected database's Connect dialog; never reuse a placeholder. Keep normal auth limits. Preview and production secrets must remain separate when required by the team's policy.
4. Generate a separate 32–256-character random `CRON_SECRET` in a password manager and save it directly as a backend secret. In the **frontend project**, configure only the public `VITE_API_URL` to the matching backend `/api/v1` URL. Never put database, Gmail, service-role or scheduler secrets under `VITE_` names. Redeploy after environment changes; existing deployments do not receive new values.
5. Check the API `/health` and `/ready`, then use a new test account to verify real signup/email verification, sign-in and invitations. Follow the seller/reviewer/buyer sequence above, including a real JPEG/PNG/WebP upload, signed read, image deletion, submit/review/publish, public detail/search, tier-aware matching and requirement lifecycle at mobile/desktop widths. Confirm unauthorized draft/image reads fail and no raw public bucket URL works. Record revision, viewport, date, outcome and correlation IDs; redact private details.
6. The backend declares `GET /api/v1/internal/storage-cleanup` in `vercel.json` at `0 3 * * *` UTC (08:00 Karachi, within that hour on Hobby). Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically. The schedule runs on production deployments, not previews. In the backend project's **Cron Jobs** section, use **Run** to verify the endpoint and inspect runtime logs for `event: image_cleanup`, `queued`, `removed`, `failed` and the correlation ID. Without scheduler credentials it returns 401; without storage it returns 503. HEAD/POST cannot run cleanup. A legitimate run returns 200 only when its batch has no failed objects.
7. A run processes at most 20 eligible jobs, retaining the existing two-minute upload grace, linked-image protection and row locks. Failed deletions remain for the next run; Vercel does not automatically retry failed invocations. For a backlog, repeat the authenticated dashboard run or use the existing `npm run storage:cleanup` CLI in the trusted backend environment, inspect failures and continue until the eligible queue is empty. Verify a successfully linked listing image still works. Observe the scheduled execution too; a successful manual run alone does not prove the schedule is active. Monitor failed runs and queue size.
8. Add the real evidence to `delivery-status.md`/`memory.md` and then check T-102 and the Week 2 hosted gate. Keep them open while any boundary is unverified. Week 1 hosted Gmail acceptance remains separately tracked.

References checked for this implementation: [Vercel cron management/authentication/retries](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [daily Hobby scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Deployment approval and provider credentials remain host configuration, not committed project data.
