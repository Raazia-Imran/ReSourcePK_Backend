const { corsOrigins } = require("../config/env");
const { AppError } = require("../lib/errors");
function cookieMutation(req, _res, next) {
  // A browser form cannot send this custom header. Cross-origin scripts require
  // a CORS preflight, and only explicitly configured frontend origins pass.
  if (
    req.get("X-ReSourcePK-CSRF") !== "1" ||
    !corsOrigins.includes(req.get("origin"))
  )
    return next(
      new AppError(
        403,
        "CSRF_REJECTED",
        "Use the trusted application to manage your session",
      ),
    );
  next();
}
module.exports = { cookieMutation };
