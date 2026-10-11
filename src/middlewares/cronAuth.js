const { createHash, timingSafeEqual } = require("node:crypto");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function requireCron(req, res, next) {
  res.set("Cache-Control", "no-store");
  const authorization = req.get("Authorization") || "";
  if (
    !env.CRON_SECRET ||
    !timingSafeEqual(digest(authorization), digest(`Bearer ${env.CRON_SECRET}`))
  )
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Scheduled job authentication required",
    );
  next();
}

module.exports = { requireCron };
