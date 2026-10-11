const { verifyAccessToken } = require("../lib/tokens");
const { AppError } = require("../lib/errors");
const db = require("../db");
const { z } = require("zod");
const claims = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  type: z.literal("access"),
});

async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token)
    return next(new AppError(401, "UNAUTHORIZED", "Sign in is required"));
  try {
    req.auth = claims.parse(verifyAccessToken(token));
  } catch {
    return next(
      new AppError(401, "UNAUTHORIZED", "Session is invalid or expired"),
    );
  }
  try {
    const result = await db.query(
      `SELECT 1 FROM app.sessions s JOIN app.users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' AND u.email_verified_at IS NOT NULL`,
      [req.auth.sid, req.auth.sub],
    );
    if (!result.rowCount)
      return next(
        new AppError(401, "UNAUTHORIZED", "Session is invalid or expired"),
      );
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAuth };
