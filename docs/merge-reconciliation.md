# Main consolidation — 11 October 2026

## Sources

- Phase 1 and production-blueprint branches were already ancestors of `main`.
- The onboarding/catalog patch is published at `b8e90e799b08b078c8d5a5ad2214ea8130700f28`; its complete tree matches the tested local patch.
- `feature/some-minor-fixes` at `e93b4d5d174e20d30dff25c1f7d870de708530f1` includes `feature/correcting-database-schema` at `97ce8af6a4ca6d48b9495e2bfdae250b0db4fc72`.
- `feature/auth-roles` has no commits ahead of the existing `main`.

## Conflict resolution and decision

The two September signup PRs target the removed public `users` schema and an unfinished alternate signup path. The controller uses an undefined database variable, never creates an account on success, and its route imports an absent controller module. Restoring those files would not produce a runnable signup flow.

Their history is incorporated through a merge parent, with the tested Phase 1/Phase 2 implementation retained as the resolved runtime tree. Email normalization, input validation, duplicate-email handling, hashing and buyer/seller registration are implemented by `authController`/`authService` and the private `app` migrations. The earlier proposal to require phone/city in the old schema is superseded by the current SRS registration contract; no phone/city migration is added. Applied migrations remain immutable.

This resolution preserves contributor commit history and avoids two contradictory auth systems. The legacy signup files and obsolete SQL schema are not restored. A merge commit is used for this consolidation so the source commits remain ancestors of `main`; future feature PRs can continue the normal squash convention.

## Verification

- Complete patch-tree equality checked against GitHub Git tree SHA.
- Backend: 6/6 existing tests pass, ESLint passes, Prettier passes.
- Frontend: ESLint and production build pass.
- Database/email/browser end-to-end acceptance remains pending local or hosted testing with actual credentials.

Use `local-preview-guide.md` for clone/run/check instructions.
