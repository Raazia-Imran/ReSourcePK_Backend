const { env } = require("../../config/env");
const { AppError } = require("../../lib/errors");

const API_ORIGIN = "https://secure.rapid-gateway.com";
let tokenCache = null;

function gatewayReady() {
  if (env.NODE_ENV === "production" && env.RAPID_GATEWAY_MODE !== "LIVE")
    throw new AppError(
      503,
      "PAYMENT_GATEWAY_DISABLED",
      "Sandbox payments are disabled in production",
    );
  if (!env.RAPID_GATEWAY_MERCHANT_ID)
    throw new AppError(
      503,
      "PAYMENT_GATEWAY_NOT_CONFIGURED",
      "RapidGateway merchant ID is not configured",
    );
  if (!env.RAPID_GATEWAY_WEBHOOK_SECRET)
    throw new AppError(
      503,
      "PAYMENT_WEBHOOK_NOT_CONFIGURED",
      "Configure the RapidGateway webhook signing secret before accepting payments",
    );
  if (env.RAPID_GATEWAY_MODE === "LIVE" && !env.RAPID_GATEWAY_CLIENT_SECRET)
    throw new AppError(
      503,
      "PAYMENT_GATEWAY_NOT_CONFIGURED",
      "RapidGateway credentials are not configured",
    );
}

async function accessToken() {
  gatewayReady();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 15_000)
    return tokenCache.value;

  const clientId =
    env.RAPID_GATEWAY_MODE === "TEST"
      ? "client"
      : env.RAPID_GATEWAY_MERCHANT_ID;
  const secret =
    env.RAPID_GATEWAY_MODE === "TEST"
      ? "secret"
      : env.RAPID_GATEWAY_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  let response;
  try {
    response = await fetch(`${API_ORIGIN}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      502,
      "PAYMENT_GATEWAY_UNAVAILABLE",
      "Payment service is unavailable",
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string")
    throw new AppError(
      502,
      "PAYMENT_GATEWAY_AUTH_FAILED",
      "Payment service authentication failed",
    );
  const expiresIn = Number(body.expires_in) || 240;
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return tokenCache.value;
}

function checkoutUrlFrom(response, body) {
  const candidate =
    response.headers.get("location") ||
    body.redirectUrl ||
    body.redirect_url ||
    body.checkoutUrl ||
    body.checkout_url ||
    body.url;
  if (typeof candidate !== "string") return null;
  try {
    const url = new URL(candidate, API_ORIGIN);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "rapid-gateway.com" ||
        url.hostname.endsWith(".rapid-gateway.com")
      )
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function createHostedCheckout({
  order,
  attempt,
  mobile,
  email,
  merchantName,
  returnUrl,
  testScenario,
}) {
  gatewayReady();
  const token = await accessToken();
  const amount = `${BigInt(order.total_minor) / 100n}.${String(BigInt(order.total_minor) % 100n).padStart(2, "0")}`;
  const basketId = attempt.provider_reference;
  const form = new URLSearchParams({
    MERCHANT_ID: env.RAPID_GATEWAY_MERCHANT_ID,
    MERCHANT_NAME: merchantName,
    TXNAMT: amount,
    CURRENCY_CODE: "PKR",
    CUSTOMER_MOBILE_NO: mobile,
    CUSTOMER_EMAIL_ADDRESS: email,
    BASKET_ID: basketId,
    TXNDESC: `ReThread order ${order.id}`.slice(0, 80),
    ORDER_DATE: new Date().toISOString().slice(0, 10),
    PROCCODE: "0",
    VERSION: "MY_VER_1.0",
    SUCCESS_URL: returnUrl,
    FAILURE_URL: returnUrl,
    CHECKOUT_URL: returnUrl,
  });
  if (env.RAPID_GATEWAY_MODE === "TEST" && testScenario)
    form.set("TEST_SCENARIO", testScenario);
  const endpoint =
    env.RAPID_GATEWAY_MODE === "TEST"
      ? `${API_ORIGIN}/sandbox/process-transaction`
      : `${API_ORIGIN}/rapid/process-transaction`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(
      502,
      "PAYMENT_GATEWAY_UNAVAILABLE",
      "Payment service is unavailable",
    );
  }
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const url = checkoutUrlFrom(response, body);
  if (
    (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) ||
    !url
  )
    throw new AppError(
      502,
      "PAYMENT_CHECKOUT_FAILED",
      "Could not start secure checkout",
    );
  return url;
}

module.exports = { createHostedCheckout, API_ORIGIN };
