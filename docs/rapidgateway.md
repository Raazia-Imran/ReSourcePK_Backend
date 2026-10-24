# RapidGateway hosted checkout

The app uses RapidGateway's hosted redirect checkout. It does not collect card or wallet credentials. The integration starts in sandbox mode; a browser return never marks an order paid. Only a verified, deduplicated webhook can complete an order.

## Sandbox setup

1. Apply migrations with `npm run db:migrate` (includes migration 016).
2. Set `RAPID_GATEWAY_MODE=TEST` and `RAPID_GATEWAY_MERCHANT_ID` in the backend `.env`.
3. Expose the backend publicly for webhook delivery during local testing (for example, through an HTTPS development tunnel).
4. In RapidGateway's TEST settings, register `https://<your-public-backend>/api/v1/rapidgateway/webhook` and copy its TEST signing secret to `RAPID_GATEWAY_WEBHOOK_SECRET`.
5. Restart the backend. An Owner must confirm a Buyer order before the Buyer sees checkout.

The test OAuth client is the documented shared `client` / `secret` pair. The backend never sends it to the browser. During local development, the checkout form offers the sandbox's explicit TEST scenarios; the backend refuses these overrides in LIVE mode. Confirm the order changes to paid only after the webhook arrives. A return page that remains on “Confirming your payment” usually means the TEST webhook URL or signing secret is not configured.

## Live configuration

Live payments stay disabled until RapidGateway supplies a merchant ID, client secret, and LIVE webhook signing secret. Set all three backend-only variables and `RAPID_GATEWAY_MODE=LIVE`; production startup rejects LIVE mode without them, and production never accepts TEST-mode payments or webhooks. Register the LIVE webhook separately from TEST. Do not put these secrets in Vite variables or frontend code.

## Flow and safeguards

- `POST /api/v1/orders/{orderId}/checkout` requires the authenticated Buyer, an order in `pending_payment`, a valid Pakistan mobile number, and a UUID idempotency key. The amount comes from the immutable server-side order snapshot.
- The backend stores a unique payment attempt before contacting RapidGateway, then returns only the hosted checkout URL and attempt details. A retry with the same key reuses the URL; a failed attempt requires a new key.
- `POST /api/v1/rapidgateway/webhook` verifies the raw-body HMAC-SHA256 signature and five-minute timestamp window, then checks merchant, environment, currency, amount, and basket reference. Event IDs are unique and replay-safe.
- A verified success commits the inventory reservation and marks the order paid in one database transaction. Failed payments leave the order payable until its existing 72-hour deadline.
- A provider success arriving after the order has expired, or after another attempt already paid it, is recorded for reconciliation and does not silently change the order or reservation.
- `GET /api/v1/payment-attempts/{attemptId}` returns status only to the Buyer who owns that attempt.
- A pending attempt is returned as `expired` once its payment deadline passes or its order becomes unpayable. If the gateway reports success after the order is no longer payable (including a second successful attempt), the attempt is marked for reconciliation; the Buyer return page warns them not to pay again.

This chunk does not implement refunds, settlement, payouts, or refunds webhook handling. Use hosted checkout only; embedded checkout and the provider's optional API-only card flow are not enabled.
