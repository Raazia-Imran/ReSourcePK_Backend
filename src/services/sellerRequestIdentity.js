const crypto = require("node:crypto");
const { env } = require("../config/env");
const { AppError } = require("../lib/errors");

function encryptionKey() {
  if (!env.SELLER_REQUEST_ENCRYPTION_KEY)
    throw new AppError(
      503,
      "SELLER_REQUEST_SECURITY_NOT_CONFIGURED",
      "Seller request submission is not available until secure identity storage is configured",
    );
  return Buffer.from(env.SELLER_REQUEST_ENCRYPTION_KEY, "hex");
}

function normalizeCnic(value) {
  const normalized = String(value).replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(normalized))
    throw new AppError(400, "CNIC_INVALID", "Enter a 13-digit CNIC number");
  return normalized;
}

function encryptCnic(value, requestId, userId) {
  const normalized = normalizeCnic(value);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`seller-request:${requestId}:${userId}`));
  const ciphertext = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    lastFour: normalized.slice(-4),
  };
}

function decryptCnic(request) {
  // Requests created before CNIC collection was introduced remain reviewable.
  if (!request.cnic_ciphertext) return null;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    request.cnic_nonce,
  );
  decipher.setAAD(
    Buffer.from(`seller-request:${request.id}:${request.user_id}`),
  );
  decipher.setAuthTag(request.cnic_auth_tag);
  return Buffer.concat([
    decipher.update(request.cnic_ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { encryptCnic, decryptCnic, normalizeCnic };
