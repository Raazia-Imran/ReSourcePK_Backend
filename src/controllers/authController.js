const { z } = require("zod");
const auth = require("../services/authService");
const { env } = require("../config/env");

const strongPassword = z
  .string()
  .min(10)
  .max(128)
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/\d/, "Password needs a number");

const registrationSchema = z.discriminatedUnion("accountType", [
  z.object({
    accountType: z.literal("buyer"),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().email(),
    password: strongPassword,
  }),
  z.object({
    accountType: z.literal("seller"),
    fullName: z.string().trim().min(2).max(120),
    organizationName: z.string().trim().min(2).max(180),
    email: z.string().email(),
    password: strongPassword,
  }),
]);
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
const tokenSchema = z.object({ token: z.string().min(32).max(200) });
const emailSchema = z.object({ email: z.string().email() });
const resetSchema = tokenSchema.extend({ password: strongPassword });

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
  refresh,
  logout,
  forgotPassword,
  resendVerification,
  resetPassword,
  me,
};
