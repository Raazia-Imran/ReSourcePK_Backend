# Google Sign-In integration contract

## Product behavior

- A first-time Google sign-in creates a baseline Buyer account. Gmail addresses and Google Workspace addresses with a verified hosted-domain claim can use Google's verified email status; other Google addresses must also complete ReSource PK email verification before the account becomes active.
- The same Google identity can later use Buyer Mode and, after separate reviewer-approved seller onboarding, Seller Mode.
- Google sign-in never grants organization membership, seller approval, Manager/Staff access, Platform Reviewer access, or Platform Admin access.
- Existing password accounts must sign in first and explicitly link Google. Email equality alone never merges accounts.

## Google Cloud and environment setup

Create an OAuth 2.0 **Web application** client in Google Cloud, configure the OAuth consent screen, and list the exact frontend origins as authorized JavaScript origins. Keep the resulting client ID public. Set the same value as `GOOGLE_CLIENT_ID` in the backend environment and `VITE_GOOGLE_CLIENT_ID` in the frontend environment. Do not add a Google client secret for this ID-token flow.

Official setup and token verification references: [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [verify Google ID tokens on the server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), and [Google Identity Services JavaScript API, including the nonce option](https://developers.google.com/identity/gsi/web/reference/js-reference).

## Frontend sign-in contract

Load Google's official Identity Services script from `https://accounts.google.com/gsi/client` and render its sign-in button on the existing sign-in/onboarding screens. Before initializing Google Identity Services, fetch a fresh login nonce from `GET /api/v1/auth/google/nonce` and pass that value as the Google `nonce` option. Nonces expire after five minutes and are single-use. The API checks the token's nonce claim and consumes it once to prevent replay.

The browser receives a credential (Google ID token), then sends both values to:

```http
POST /api/v1/auth/google
Content-Type: application/json

{"credential":"<Google ID token>","nonce":"<nonce from this API>"}
```

On `200`, store the returned short-lived `data.accessToken` using the existing in-memory session behavior and load `data.context`. The API sets the rotating refresh token in its HttpOnly cookie. On `202`, tell the user to verify their email and do not establish a session yet. Do not store the Google credential, expose it in logs/analytics, or use its client-side claims to authorize application actions.

For an existing password account, first authenticate with the existing method. Fetch a fresh account-bound nonce from `GET /api/v1/auth/google/link/nonce` using the current bearer access token, then initialize Google Identity Services with that nonce. Request a fresh Google credential for the same email and send it with both values and the current bearer access token:

```http
POST /api/v1/auth/google/link
Authorization: Bearer <ReSource PK access token>
Content-Type: application/json

{"credential":"<Google ID token>","nonce":"<account-bound nonce from this API>"}
```

If Google sign-in returns `409 GOOGLE_LINK_REQUIRED`, direct the user to sign in with their existing method and explicitly link Google. Do not silently create a second account or link based only on an email match.

## Current scope boundary

The backend endpoint and Google identity persistence are implemented here. The frontend repository is not part of this checkout, so its button, callback, `VITE_GOOGLE_CLIENT_ID`, session wiring, and dashboard switch still need implementation. Seller onboarding approval and granular Platform Admin permission management are separate workflows and are not granted by these endpoints.
