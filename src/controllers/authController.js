const { z } = require("zod");
const auth = require("../services/authService");
const googleAuth = require("../services/googleAuthService");
const { env } = require("../config/env");

const { strongPassword } = require("../lib/password");

const registrationSchema = z.discriminatedUnion("accountType", [
  z
    .object({
      accountType: z.literal("buyer"),
      fullName: z.string().trim().min(2).max(120),
      email: z.string().email().max(254),
      password: strongPassword,
    })
    .strict(),
  z
    .object({
      accountType: z.literal("seller"),
      fullName: z.string().trim().min(2).max(120),
      organizationName: z.string().trim().min(2).max(180),
      email: z.string().email().max(254),
      password: strongPassword,
    })
    .strict(),
]);
const loginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
const tokenSchema = z.object({ token: z.string().min(32).max(200) }).strict();
const emailSchema = z.object({ email: z.string().email().max(254) }).strict();
const resetSchema = tokenSchema.extend({ password: strongPassword });
const googleCredentialSchema = z
  .object({
    credential: z.string().min(100).max(8192),
    nonce: z.string().min(32).max(200),
  })
  .strict();
const sellerGoogleCredentialSchema = googleCredentialSchema.extend({
  organizationName: z.string().trim().min(2).max(180).optional(),
});

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 500) || null,
  };
}

function cookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    path: "/api/v1/auth",
    maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000,
  };
}

async function register(req, res) {
  const result = await auth.register(
    registrationSchema.parse(req.body),
    requestMeta(req),
  );
  res.status(201).json({ data: result });
}
async function verifyEmail(req, res) {
  res.json({
    data: await auth.verifyEmail(
      tokenSchema.parse(req.body).token,
      requestMeta(req),
    ),
  });
}
async function login(req, res) {
  const result = await auth.login(
    loginSchema.parse(req.body),
    requestMeta(req),
  );
  res.cookie("refresh_token", result.refreshToken, cookieOptions());
  res.json({
    data: { accessToken: result.accessToken, context: result.context },
  });
}
async function googleLogin(req, res) {
  const input = googleCredentialSchema.parse(req.body);
  const result = await googleAuth.signIn(
    input.credential,
    input.nonce,
    requestMeta(req),
  );
  if (result.verificationRequired)
    return res.status(202).json({
      data: {
        verificationRequired: true,
        ...(result.emailDelivery
          ? { emailDelivery: result.emailDelivery }
          : {}),
      },
    });
  res.cookie("refresh_token", result.refreshToken, cookieOptions());
  res.json({
    data: { accessToken: result.accessToken, context: result.context },
  });
}
async function googleSellerLogin(req, res) {
  const input = sellerGoogleCredentialSchema.parse(req.body);
  const result = await googleAuth.signIn(
    input.credential,
    input.nonce,
    requestMeta(req),
    { accountType: "seller", organizationName: input.organizationName },
  );
  if (result.verificationRequired)
    return res.status(202).json({
      data: {
        verificationRequired: true,
        ...(result.emailDelivery
          ? { emailDelivery: result.emailDelivery }
          : {}),
      },
    });
  res.cookie("refresh_token", result.refreshToken, cookieOptions());
  res.json({
    data: { accessToken: result.accessToken, context: result.context },
  });
}
async function linkGoogle(req, res) {
  const input = googleCredentialSchema.parse(req.body);
  res.json({
    data: await googleAuth.link(
      req.auth.sub,
      input.credential,
      input.nonce,
      requestMeta(req),
    ),
  });
}
async function googleNonce(req, res) {
  res.set("Cache-Control", "no-store");
  res.json({ data: { nonce: await googleAuth.createNonce("login") } });
}
async function googleSellerNonce(req, res) {
  res.set("Cache-Control", "no-store");
  res.json({ data: { nonce: await googleAuth.createNonce("seller_login") } });
}
async function googleLinkNonce(req, res) {
  res.set("Cache-Control", "no-store");
  res.json({
    data: { nonce: await googleAuth.createNonce("link", req.auth.sub) },
  });
}
async function refresh(req, res) {
  const result = await auth.refresh(
    req.cookies.refresh_token,
    requestMeta(req),
  );
  res.cookie("refresh_token", result.refreshToken, cookieOptions());
  res.json({
    data: { accessToken: result.accessToken, context: result.context },
  });
}
async function logout(req, res) {
  await auth.logout(req.cookies.refresh_token);
  res.clearCookie("refresh_token", cookieOptions());
  res.status(204).end();
}
async function forgotPassword(req, res) {
  await auth.forgotPassword(emailSchema.parse(req.body).email);
  res.json({
    data: { message: "If that account exists, a reset link has been sent." },
  });
}
async function resendVerification(req, res) {
  await auth.resendVerification(emailSchema.parse(req.body).email);
  res.json({
    data: {
      message: "If that account needs verification, a new link has been sent.",
    },
  });
}
async function resetPassword(req, res) {
  const input = resetSchema.parse(req.body);
  await auth.resetPassword(input.token, input.password, requestMeta(req));
  res.status(204).end();
}
async function me(req, res) {
  res.json({ data: await auth.loadContext(req.auth.sub) });
}

module.exports = {
  register,
  verifyEmail,
  login,
  googleLogin,
  googleSellerLogin,
  linkGoogle,
  googleNonce,
  googleSellerNonce,
  googleLinkNonce,
  refresh,
  logout,
  forgotPassword,
  resendVerification,
  resetPassword,
  me,
};
