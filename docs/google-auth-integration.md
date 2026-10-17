# Google Sign-In integration contract

## Product behavior

- Buyer and Seller have separate Google sign-in entry points, but both resolve to the same canonical user and may use the same Google identity. A person who starts as a Buyer keeps Buyer access after Seller approval; Seller is added through organization membership.
- A first-time Google sign-in creates the person's account. The Seller entry point requires an organization name when the user has no pending request or approved Seller membership, and creates a pending request. Gmail addresses and Google Workspace addresses with a verified hosted-domain claim can use Google's verified email status; other addresses must also complete ReSource PK email verification before a session is issued.
- Google sign-in never grants organization membership, seller approval, Manager/Staff access, Platform Reviewer access, or Platform Admin access.
- Seller Google sign-in does not grant Seller access. A Platform Reviewer or Platform Admin must approve the request, which creates the organization and Owner membership on the same user while retaining Buyer access. Existing authenticated accounts may also submit through `POST /api/v1/seller/requests`.
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

For the Seller entry point, fetch a Seller-specific nonce from `GET /api/v1/auth/google/seller/nonce`, pass it to Google Identity Services, then send the Google credential and nonce to `POST /api/v1/auth/google/seller`. The same Google account used for Buyer sign-in is accepted. Include `organizationName` when submitting a new Seller request; omit it if a request is already pending or Seller membership is already approved. The Seller nonce cannot be used with the Buyer endpoint. On `200`, use the returned canonical account session; query `GET /api/v1/seller/requests/mine` for review status. After approval, the response context includes Seller organization membership while Buyer access remains. On `202`, ask the user to complete email verification, then repeat sign-in with a fresh nonce.

For an existing password account, first authenticate with the existing method. Fetch a fresh account-bound nonce from `GET /api/v1/auth/google/link/nonce` using the current bearer access token, then initialize Google Identity Services with that nonce. Request a fresh Google credential for the same email and send it with both values and the current bearer access token:

```http
POST /api/v1/auth/google/link
Authorization: Bearer <ReSource PK access token>
Content-Type: application/json

{"credential":"<Google ID token>","nonce":"<account-bound nonce from this API>"}
```

If Google sign-in returns `409 GOOGLE_LINK_REQUIRED`, direct the user to sign in with their existing method and explicitly link Google. Do not silently create a second account or link based only on an email match.

## Current scope boundary

The Buyer and Seller backend entry points, shared Google identity persistence, and Seller request/review API are implemented here. The frontend repository is not part of this checkout, so its Google buttons, callbacks, `VITE_GOOGLE_CLIENT_ID`, session wiring, and reviewer/admin screens still need implementation. Seller access is granted only by approved membership, never by Google claims.
