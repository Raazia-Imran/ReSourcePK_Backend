const { verifyAccessToken } = require("../lib/tokens");
const { AppError } = require("../lib/errors");

function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token)
    return next(new AppError(401, "UNAUTHORIZED", "Sign in is required"));
  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch {
    return next(
      new AppError(401, "UNAUTHORIZED", "Session is invalid or expired"),
    );
  }
}

module.exports = { requireAuth };
