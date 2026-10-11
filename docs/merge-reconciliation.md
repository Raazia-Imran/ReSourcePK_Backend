# Main consolidation — 11 October 2026

## Sources

- Phase 1 and production-blueprint branches were already ancestors of `main`.
- The onboarding/catalog patch is published at `b8e90e799b08b078c8d5a5ad2214ea8130700f28`; its complete tree matches the tested local patch.
- `feature/some-minor-fixes` at `e93b4d5d174e20d30dff25c1f7d870de708530f1` includes `feature/correcting-database-schema` at `97ce8af6a4ca6d48b9495e2bfdae250b0db4fc72`.
- `feature/auth-roles` has no commits ahead of the existing `main`.

## Conflict resolution and decision

The two September signup PRs target the removed public `users` schema and an unfinished alternate signup path. The controller uses an undefined database variable, never creates an account on success, and its route imports an absent controller module. Restoring those files would not produce a runnable signup flow.

The user clarified that only their own feature work should be included. The consolidation merge introduced these two legacy commits as ancestors; that merge is replaced by a single-parent commit based on the user's published onboarding/catalog commit. The working runtime tree and preview guide are retained. The original consolidation tip is retained on `archive/consolidation-before-author-scope-correction` for recovery only; it must not be merged into `main`.

The legacy signup branches are excluded from `main` again. Email normalization, validation, duplicate handling and hashing remain in the user's current auth implementation. No phone/city migration is added. GitHub may retain the historical merged badge on PRs #1/#2; commit ancestry, rather than the badge, establishes whether they are in the current `main`. Future work uses scoped branches and PRs without parent links to those legacy branches.

## Verification

- Complete patch-tree equality checked against GitHub Git tree SHA.
- Backend: 6/6 existing tests pass, ESLint passes, Prettier passes.
- Frontend: ESLint and production build pass.
- Database/email/browser end-to-end acceptance remains pending local or hosted testing with actual credentials.

Use `local-preview-guide.md` for clone/run/check instructions.
