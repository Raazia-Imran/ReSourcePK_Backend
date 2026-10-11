const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, sid: sessionId, type: "access" },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL,
      issuer: "resource-pk-api",
      audience: "resource-pk-web",
      algorithm: "HS256",
    },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "resource-pk-api",
    audience: "resource-pk-web",
    algorithms: ["HS256"],
  });
}

module.exports = { randomToken, hashToken, signAccessToken, verifyAccessToken };
