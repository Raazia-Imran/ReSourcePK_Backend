# Phase 2 catalog progress and handoff

Updated 28 September 2026. This branch builds on the Phase 1 foundation and the user's onboarding feedback. Staging database `ReSourcePK-Staging` has migration `003_catalog.sql` applied; the application migration ledger now records migrations 001–003 so `npm run db:migrate` skips the already-applied files on this project. Run new migrations only through the numbered migration workflow, never by editing an applied migration.

## Fixed from the local setup feedback

- Signup separates Buyer and Seller inputs and clears values when switching; password inputs can be revealed on purpose. The browser's own password manager can still offer stored credentials.
- Signup, login and verification expose a resend link; invalid fields return specific server validation messages. The reset form can reveal the password and rejects reuse of the immediately previous password.
- An existing verified Buyer can create a Seller organization using their existing account. Seller workspace defaults to Organization; buying is an explicit action rather than an unexplained dropdown.
- An Owner creates the organization and can invite Manager or Staff; a Manager can invite Staff only with the delegated permission. The old `org_admin` database enum remains for migration compatibility, but new invitations cannot assign it and that role is not privileged in this flow.
- Invitation acceptance displays the invited email, requires sign-in for existing accounts, lets a new invitee choose their own password, blocks mismatched signed-in accounts with a clear sign-out path, and consumes the hashed one-time token on acceptance. It expires in 72 hours.

## Week 2 work implemented

- Three new private staging tables: listings, buyer requirements, and idempotent listing import batches.
- Seller Owner/Manager can create and edit drafts, submit for review; Platform Admin can publish or reject. Public catalog returns only published listings, with indexed search, material filter, price sorting and pagination.
- Buyer requirements have a matching endpoint with an explicit explanation of material, unit, quantity, price limit and direct MOQ eligibility. Checkout/group buying is not active yet.
- CSV/XLSX stock sheet: template → upload → validate up to 100 rows → row error report → review → atomic, idempotent commit to drafts. Maximum upload is 2 MB, XLSX expansion is bounded to 8 MB. Each imported draft needs review before publication.
- React Buyer catalog/requirements, Seller draft/import, and Platform review screens use actual API records and honest empty states. No invented product inventory or analytics figures were seeded.

## Remaining before the Week 2 gate

1. Configure and run a hosted API with its database and Gmail environment variables. No database password or Gmail app password is committed. Use fresh buyer/seller test accounts; run seller draft → platform approval → public search → buyer match on staging. A secure Platform Admin provisioning procedure is required for that step.
2. Add the image upload/storage adapter and image validation, listing archive/deletion policy, price tiers, and image UI. Current listings contain text, quantity, MOQ and unit price only.
3. Add a representative, clearly labelled demo dataset through an opt-in seed workflow. Do not claim real suppliers or impact figures.
4. Test import with real factory CSV and XLSX files, malformed formulas/oversized archives, duplicate commit replay, wrong organization, expired invites, and role revocation against a running API and staging database.
5. Browser device-width, keyboard and reduced-motion reviews remain pending because a browser runtime was unavailable in this execution environment. Static build and lint are not substitutes for visual QA.

The full Week 2 gate in `tasks.md` is **not yet complete**. Payments, direct/group checkout, financial reports and blockchain remain later phases. The frontend and backend feature branches must be reviewed together, since the new UI needs migration 003 and the new API routes.
