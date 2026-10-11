# ADR 004: complete the catalog before commerce

Date: 11 October 2026. Scope: T-101 through T-107 plus necessary identity regression fixes. Week 3 commerce remains gated on Week 2 acceptance.

## Decisions

- Retain the Express/PostgreSQL monolith, existing verified-email authentication, and Nodemailer/Gmail. Supabase provides PostgreSQL and private object storage; it does not replace the current identity system. Browser code never receives the database URL or storage service credential.
- Keep migration 003 decimal price columns for display/input compatibility. Migration 004 generates exact integer paisa columns in PostgreSQL. Tiers store BIGINT paisa. API validation and tier comparisons use decimal text and scaled BigInt, never floating point rounding. Future financial calculations must use minor-unit columns, not compatibility display values.
- An active Owner or Manager may edit only draft/rejected stock. Submit, edit, archive, review and image mutations require the current version. Archive is terminal, retains history and immediately removes stock from discovery/matching. Review requires an explicit reason. Price tiers increase from MOQ to available stock and prices never increase.
- Requirements transition active ↔ paused, or either to terminal closed. Only the buyer can change them. Matching uses published stock from active organizations and the applicable quantity tier; MOQ eligibility is separate from matching. No payment or group-buying behavior is implied.
- Image storage uses a private bucket restricted to WebP and 5 MB, with no browser Storage policies. The API validates membership/reviewer access. Accept JPEG/PNG/WebP raster input only, at most 5 MB and 16 megapixels; reject animation; decode with strict warnings and bounded time; strip metadata and re-encode to at most 1600 × 1600. Objects have random server names. Authorized 60-second download capabilities can remain usable until expiry after a state change. Object deletion has a retryable cleanup queue.
- XLSX accepts up to 100 entries and 8 MB actual expansion. Native bounded decompression verifies declared sizes and CRCs, then rebuilds a safe archive so unlisted local headers never reach the workbook parser. CSV/XLSX imports stay draft-only, with atomic idempotency and row errors.
- Demo records are explicit synthetic fixtures, never runtime fallbacks. The opt-in seed refuses production, requires a caller-supplied strong password, marks listings `is_demo`, and preserves previously seeded records. It sends no emails. Demo data must be excluded from real analytics by default.
- Access tokens bind to a live session ID, with HS256 pinned. Protected requests check session expiry/revocation and active verified user status. Logout/reset revoke access immediately; rotating a refresh session also invalidates its old access token. Existing sessions must sign in again after this API change. Cookie refresh/logout require the configured Origin and a custom preflight-protected header. Frontend refreshes are deduplicated.
- Invitations recheck the inviter's current grant permission on acceptance. Legacy/unassignable roles are rejected; an invitation cannot replace an Owner role.

## Capacity and deployment limits

Use the provider pooler, a bounded per-instance connection pool, indexed public filters and consistent bounded pagination. Maximum public offset is 9,950 records; seller/review/requirement screens currently cap at 100 records. Cursor pagination, global rate limiting, query-plan/load validation and scheduled cleanup remain production gates. Memory rate limits protect only one API process; they are not a distributed abuse-control system.

`TRUST_PROXY_HOPS=0` is the safe direct-local default. Set the exact trusted proxy count only after checking the hosting topology. Deploy migration → API → frontend together. Do not rewrite applied migrations: the advisor index correction is migration 005.

## Dependencies reviewed

- `sharp` 0.35.5, Apache-2.0: native raster decoding/re-encoding; selected because header checks alone cannot validate images. Constructor limits: <https://sharp.pixelplumbing.com/api-constructor/>.
- `@supabase/supabase-js` 2.117.3, MIT: maintained official Storage adapter, server-only. Private bucket and signed URL model: <https://supabase.com/docs/guides/storage/buckets/fundamentals>.
- Both are pinned in the lockfile. Production npm audits reported zero known vulnerabilities on 11 October 2026. This is a point-in-time dependency check, not a guarantee.
- CI action references are immutable SHAs. Secret scanning runs without PR comments. Hosted PostgreSQL/API, SMTP and object-storage credentials remain outside source control.
