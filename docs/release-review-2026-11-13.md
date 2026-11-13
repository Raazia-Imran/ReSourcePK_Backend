# Integration review — 13 November 2026

## Decision

Integrate `feature/step-8` and the impact-specific additions from `feature/step-10-impact-events`. Preserve the newer routes, payment transitions, canonical passport implementation, outbox worker and tests from Step 8. Step 10 independently copied older files, so a blind merge would regress them. The integration branch resolves those overlaps explicitly. No historical SQL migration from Step 8 is changed.

`feature/week4-passport`, `feature/step-6-polygon-smart-contract` and `feature/step-7-blockchain-outbox` are ancestors of Step 8. Do not merge them separately. Frontend `fix/rethread-ui-polish` equals main. Foundation, blueprint, catalog-completion and onboarding branches already have their work in main. Older acceptance/CI branches contain earlier variants of work later consolidated into main. Keep recovery archives and legacy signup branches unmerged; see merge-reconciliation.md.

## Contributions in the requested window

Window: 30 October–13 November 2026, using Git author dates across fetched remote branches. Waheeba (`khan123318`, repository email identifies Waheeba Khan) has eight new backend commits: fulfilment/snapshots, Polygon registry, blockchain outbox/recovery tests, public verification and impact events. No frontend commits or Amna-authored commits appear in this window. This does not establish whether either person has unpushed work. Amna's latest visible work is 25 October and already in main: purchase/payment workflows, dashboards, approval/permissions and frontend checkout/status handling.

## Checks performed

- Clean Node 24 installs with dependency lifecycle scripts disabled.
- Frontend: lint, formatting and production build pass with a non-live placeholder API URL. This is build evidence only.
- Combined backend: 97 unit tests, lint and formatting pass. Fixed invalid indentation that duplicated a `post` key in OpenAPI.
- Isolated PostgreSQL 18.6: migrations 001–021 apply; all 26 integration tests pass, including purchase concurrency, immutable passports, impact diversion and refund reversal. No hosted database was changed.
- Contract project: build and TypeScript checks pass; 9 local tests pass, including unauthorized writer and repeat-anchor rejection. No paid or public-chain transaction was sent.
- Dependency audit: no high/critical findings; 4 backend and 5 frontend moderate findings in development tooling. No broad automatic dependency downgrade applied.

## Remaining work, in priority order

1. Run combined GitHub CI and paired browser acceptance before merging. Local Chromium cannot start under this execution environment; this is not a browser acceptance pass. CI pins the reviewed paired frontend.
2. Configure hosting secrets directly in the host, then verify clean-account email, Google sign-in, seller review and private image upload/read/delete.
3. Fulfilment controls, receipt confirmation, disputes and public passport verification UI are implemented in the paired frontend. Real provider refund and dispute-resolution workflows remain open.
4. Configure and observe Polygon Amoy contract, funded test wallet, RPC and separately running outbox worker. Validate the contract's zero-key/hash behavior before production use. Keep all chain claims labelled testnet.
5. Complete sandbox payment provider acceptance, settlement ledger/reconciliation and the actual refund process. `simulateRefund` is simulated, not a provider refund.
6. Impact history now rejects UPDATE/DELETE and duplicate reversals. Seller/platform dashboards show quantities by unit. Business metrics expose GMV, AOV, payment and cancellation rates, repeat purchasers, recorded refunds and group funding. Revenue, profit, CAC/CLV and environmental savings remain unavailable until their source data exists.
7. Finish verified-order ratings, any approved messaging, report centre and CSV/PDF exports.
8. Complete cross-role browser, accessibility, load, backup restore, worker outage/recovery and monitoring checks.

## Cloudflare deployment

Frontend is a static Vite application: Git repo ReSourcePK_Frontend, production branch main, build `npm run build`, output `dist`, Node 24. Set `VITE_API_URL` to the deployed API URL ending `/api/v1`; `VITE_GOOGLE_CLIENT_ID` is public configuration. Never add backend secrets to a VITE variable. Keep SPA deep-link fallback enabled.

Backend is not a static Pages build. Cloudflare Workers now supports Express through Node HTTP compatibility, but this repository has no reviewed Workers entry/config. Validate PostgreSQL connections, Sharp native image processing and SMTP before selecting that runtime. The persistent `src/worker/index.js` loop requires a separate long-running host or a reviewed bounded scheduled/queue worker adaptation. Do not upload the backend directory as static files or claim it is deployed from a frontend build.

For browser sessions, confirm secure refresh cookies work for the actual UI/API origins. Prefer same-site custom subdomains or a reviewed same-origin proxy, with exact CORS allowlists. Configure cleanup, purchase expiry and outbox scheduling, not only HTTP hosting.

Remote device is now online. Wrangler 4.161.0 reports unauthenticated. No Cloudflare deployment or hosted database changes occurred. Do not deploy a frontend with a localhost or placeholder API URL.

## Added metrics definitions

The default cohort is orders created in the last 30 UTC days. Optional ISO `from` and `to` query values select a positive interval up to 366 days, with an exclusive end. Seller endpoint: `GET /organizations/:organizationId/commerce-metrics` (owner or manager with orders.confirm); platform endpoint: `GET /platform/commerce-metrics` (platform admin). Both require sign-in. Samples are excluded using listing flags and demo buyer registry records.

Paid GMV sums each order once when it has a succeeded or subsequently refunded payment attempt. AOV divides this by paid orders. Payment rate divides paid orders by placed orders. Payment attempt success includes subsequently refunded attempts. Repeat purchasers means buyers with at least two paid orders within the cohort, not lifetime retention. Cancellation includes rejection/expiry and fulfilment cancellation. Recorded refunds include simulations and do not prove bank settlement. Group funding rate uses paid groups divided by paid plus expired groups created in the same interval. An absent denominator displays a dash. The reporting SQL is parameterized; permission, period, exact counts and demo exclusion are covered by integration tests.

## Simple remaining-work list against the team plan

- Earn paired browser CI acceptance and then merge the reviewed integration branches into main.
- Configure deployed API/database, exact CORS/cookies, email, Google sign-in, private storage and scheduled jobs.
- Authenticate Cloudflare and deploy the frontend against that reachable HTTPS API.
- Prove seller approval, publish, direct/group order, sandbox payment, dispatch, receipt and passport lookup through the deployed UI.
- Configure Amoy RPC, funded test wallet, deployed registry and outbox worker; retain transaction and verification evidence.
- Finish refund-provider integration, settlement/reconciliation and dispute resolution, followed by verified-order ratings.
- Complete role-aware reports and CSV/PDF exports. Messaging remains optional in the team plan.
- Add reviewed financial inputs for revenue, margin, CAC/CLV and visitor funnel reporting; reviewed environmental factors for savings estimates.
- Run backup restore, worker recovery, monitoring, load and hosted accessibility checks.
