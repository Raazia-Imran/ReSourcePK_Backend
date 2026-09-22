const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, type: "access" },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL,
      issuer: "resource-pk-api",
      audience: "resource-pk-web",
    },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "resource-pk-api",
    audience: "resource-pk-web",
  });
}

module.exports = { randomToken, hashToken, signAccessToken, verifyAccessToken };
