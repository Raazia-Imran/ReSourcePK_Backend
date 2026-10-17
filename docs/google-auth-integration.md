# Google Sign-In integration contract

## Product behavior

- Buyer and Seller use separate Google sign-in entry points and separate Google identities. Existing Buyer identities remain assigned to Buyer sign-in; a Google identity cannot authenticate through both entry points.
- A first-time Buyer Google sign-in creates a Buyer account. A first-time Seller Google sign-in requires an organization name and creates a Seller applicant plus a pending Seller request. Gmail addresses and Google Workspace addresses with a verified hosted-domain claim can use Google's verified email status; other addresses must also complete ReSource PK email verification before a session is issued.
- Google sign-in never grants organization membership, seller approval, Manager/Staff access, Platform Reviewer access, or Platform Admin access.
- Seller Google sign-in does not grant Seller access. A Platform Reviewer or Platform Admin must approve the automatically created request, which creates the organization and Owner membership. Existing authenticated accounts may also submit through `POST /api/v1/seller/requests`.
- Platform Admins can list all requests, approve/reject requests, and grant/revoke Platform Reviewer role through the `/api/v1/platform/...` endpoints.
- Existing password accounts must sign in first and explicitly link Google. Email equality alone never merges accounts.

## Google Cloud and environment setup

Create an OAuth 2.0 **Web application** client in Google Cloud, configure the OAuth consent screen, and list the exact frontend origins as authorized JavaScript origins. Keep the resulting client ID public. Set the same value as `GOOGLE_CLIENT_ID` in the backend environment and `VITE_GOOGLE_CLIENT_ID` in the frontend environment. Do not add a Google client secret for this ID-token flow.

Official setup and token verification references: [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [verify Google ID tokens on the server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), and [Google Identity Services JavaScript API, including the nonce option](https://developers.google.com/identity/gsi/web/reference/js-reference).

## Frontend sign-in contract

Load Google's official Identity Services script from `https://accounts.google.com/gsi/client` and render its sign-in button on the existing sign-in/onboarding screens. Before initializing Google Identity Services, fetch a fresh login nonce from `GET /api/v1/auth/google/nonce` and pass that value as the Google `nonce` option. Nonces expire after five minutes and are single-use. The API checks the token's nonce claim and consumes it once to prevent replay.

For Buyer sign-in, the browser receives a credential (Google ID token), then sends both values to:

```http
POST /api/v1/auth/google
Content-Type: application/json

{"credential":"<Google ID token>","nonce":"<nonce from this API>"}
```

On `200`, store the returned short-lived `data.accessToken` using the existing in-memory session behavior and load `data.context`. The API sets the rotating refresh token in its HttpOnly cookie. On `202`, tell the user to verify their email and do not establish a session yet. Do not store the Google credential, expose it in logs/analytics, or use its client-side claims to authorize application actions.

For Seller sign-in, fetch a Seller-specific nonce from `GET /api/v1/auth/google/seller/nonce`, pass it to Google Identity Services, then send the Google credential and nonce to `POST /api/v1/auth/google/seller`. Include `organizationName` on first-time Seller registration; omit it on later sign-ins. The Seller nonce cannot be used with the Buyer endpoint. On `200`, create the session and show the Seller request's pending/review state; query `GET /api/v1/seller/requests/mine` for its current status. On `202`, ask the user to complete email verification, then repeat Seller sign-in with a fresh Seller nonce.

For an existing password account, first authenticate with the existing method. Fetch a fresh account-bound nonce from `GET /api/v1/auth/google/link/nonce` using the current bearer access token, then initialize Google Identity Services with that nonce. Request a fresh Google credential for the same email and send it with both values and the current bearer access token:

```http
POST /api/v1/auth/google/link
Authorization: Bearer <ReSource PK access token>
Content-Type: application/json

{"credential":"<Google ID token>","nonce":"<account-bound nonce from this API>"}
```

If Google sign-in returns `409 GOOGLE_LINK_REQUIRED`, direct the user to sign in with their existing method and explicitly link Google. Do not silently create a second account or link based only on an email match.

## Current scope boundary

The Buyer and Seller backend entry points, Google identity persistence, and seller request/review API are implemented here. The frontend repository is not part of this checkout, so its Google buttons, callbacks, `VITE_GOOGLE_CLIENT_ID`, session wiring, and reviewer/admin screens still need implementation. Seller access is granted only by approved membership, never by Google claims.
