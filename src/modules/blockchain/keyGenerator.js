const { ethers } = require("ethers");

/**
 * Generates a deterministic blockchain key for a passport snapshot.
 *
 * The key is derived from:
 * passportId:version-<version>
 *
 * ethers.id() uses Keccak-256 and returns a bytes32 hexadecimal value.
 */
function generatePassportKey(passportId, version) {
  if (typeof passportId !== "string" || !passportId.trim()) {
    throw new TypeError("A valid passportId is required");
  }

  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("A valid passport version is required");
  }

  const keyInput = `${passportId}:version-${version}`;

  return ethers.id(keyInput);
}

module.exports = {
  generatePassportKey,
};