# Engineering Rules

## Authority order

`srs.md` defines required behavior; `architecture.md` defines structural boundaries; `design.md` defines UI behavior; `tasks.md` sequences delivery. When a conflict is found, stop, record the decision in `memory.md`/an ADR, update the documents, then code.

## Non-negotiable rules

1. Node.js + Express is the MVP backend. Do not introduce FastAPI or microservices without an approved ADR.
2. PostgreSQL is the source of truth. Vendors are adapters.
3. Never commit secrets. Keep `.env.example` to names and safe descriptions only.
4. Authorization is enforced server-side for every resource and tenant boundary.
5. Passwords use a modern adaptive hash; tokens/invite codes stored at rest are hashed where possible.
6. Browser-supplied prices, roles, organization IDs and lifecycle states are untrusted.
7. Money uses integer minor units; quantities use fixed precision, never binary floating point.
8. Controllers validate/translate; services own business rules and transactions; repositories own queries.
9. External callbacks are authenticated and idempotent. Redirect pages never mark payment successful.
10. Pool joins and inventory reservations are atomic and concurrency tested.
11. Completed passport source data is immutable; corrections are linked events/versions.
12. No personal or commercially sensitive data is written on-chain.
13. Database changes use reviewed forward migrations; never manually patch production schema.
14. Logs are structured and redact secrets/PII. Every request has a correlation ID.
15. All meaningful privileged actions emit audit events with actor, target, action, reason and time.
16. Accessibility and responsiveness are acceptance criteria, not post-release polish.
17. No direct commits to `main`; use a scoped branch, PR, review and passing CI.
18. Prefer small vertical slices. A feature is not done until UI, API, data, policy, tests and error states work together.
19. Do not claim a feature is real when it is mocked. Label provider simulators and testnets clearly.
20. Do not add dependencies without checking maintenance, license, vulnerabilities and whether the platform already provides the capability.

## Code standards

- JavaScript is permitted for the existing baseline; migrate incrementally to TypeScript only with one agreed plan, not mixed ad hoc.
- ESLint and Prettier are required. Use clear names, small functions and feature modules.
- CI dependency installation must use `npm ci --ignore-scripts`. Keep application tests/builds as explicit steps; do not re-enable all dependency lifecycle hooks to fix one package. Any necessary native build must be reviewed and explicitly scoped.
- Validate API inputs with a schema library and reject unknown security-sensitive fields.
- Use parameterized SQL/query builder/ORM; add database constraints even when validation exists.
- Return stable machine error codes. Never expose stack traces in production.
- API route format: `/api/v1/<resource>`; plural nouns; pagination on collections.
- Tests: unit for pricing/policy/state machines; integration for database and callbacks; end-to-end for critical journeys.
- Every bug fix adds a regression test when practical.

## Pull-request gate

- Requirement/acceptance criterion linked.
- No secret or generated artifact added.
- Authorization and tenant isolation considered.
- Migration is reversible or has a documented recovery path.
- Tests, lint and production build pass.
- Mobile, keyboard and failure-state behavior checked for UI changes.
- OpenAPI, docs and seed data updated where relevant.
- Reviewer can reproduce with documented commands.

## Git conventions

- Branch: `feature/<scope>`, `fix/<scope>`, `docs/<scope>`.
- Commit: imperative Conventional Commit style, e.g. `feat(pools): make joins idempotent`.
- Squash merge; delete merged branches. Protect `main` and require at least one reviewer.

## Catalog review clarifications — 11 October 2026

Integer paisa columns are authoritative for financial use; decimal compatibility fields are for exact input/display. Never calculate transaction totals in React. Keep fixture data in the explicit demo seed, never in runtime catalog fallbacks; passwords must come from the user environment, with no seeded default. Preserve applied SQL files and use new numbered migrations for advisor fixes. Every status/image/import mutation is scoped and audited. CI uses isolated local PostgreSQL and must not target project credentials; database tests refuse nonlocal/non-test database URLs. No hosted, device, antivirus, load or backup-restore gate is inferred from lint or build results.

## Week 2 verification rules — 11 October 2026

Pin cross-repository browser-test inputs to a reviewed revision (an explicit CI variable may select another reviewed revision). Test authentication through real API sessions and isolate fixtures in a local `resourcepk_test_*` database. Capture synthetic screenshots without auth traces. Treat vendor failures injected in tests as simulated evidence only. Keep runtime business data, credentials and URLs configuration-driven; constants defining reviewed validation bounds and test fixture data are allowed. New collection contracts require synchronized OpenAPI/UI deployment.

## Scheduler boundary — 11 October 2026

Use backend-only `CRON_SECRET` for image maintenance, separate from account JWTs. Never authenticate by user-agent, query-string token or UI role. Keep scheduler responses uncached and reject HEAD/POST before work. Route code reuses the existing cleanup service; no SQL or provider deletion belongs in the route. Synthetic scheduler tests are explicitly isolated from provider credentials. Cron configuration is versioned; hosted schedule activation/logs and provider checks remain required before release sign-off.
