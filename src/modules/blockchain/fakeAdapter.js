const { randomBytes } = require("node:crypto");

const ZERO_HASH = `0x${"0".repeat(64)}`;

class FakeAdapter {
  constructor({ failuresBeforeSuccess = 0, alwaysFail = false } = {}) {
    // Simulates the hashes mapping in PassportRegistry.sol.
    this.hashes = new Map();
    this.failuresBeforeSuccess = failuresBeforeSuccess;
    this.alwaysFail = alwaysFail;
    this.failureCount = 0;
  }

  // Checks that a value is a valid bytes32 hexadecimal string.
  validateBytes32(value, fieldName) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new TypeError(
        `${fieldName} must be a valid bytes32 hexadecimal value`,
      );
    }
  }

  // Simulates the contract's get(bytes32 key) function.
  async get(key) {
    this.validateBytes32(key, "key");

    return this.hashes.get(key.toLowerCase()) || ZERO_HASH;
  }

  // Simulates the contract's anchor(bytes32 key, bytes32 hash) function.
  async anchor(key, hash) {
    this.validateBytes32(key, "key");
    this.validateBytes32(hash, "hash");

    const normalizedKey = key.toLowerCase();

    // The Solidity contract does not allow an existing key to be anchored again.
    if (this.hashes.has(normalizedKey)) {
      throw new Error("already anchored");
    }

    // Simulate temporary or permanent blockchain failures.
    this.failureCount += 1;

    if (this.alwaysFail || this.failureCount <= this.failuresBeforeSuccess) {
      throw new Error("Simulated blockchain transaction failure");
    }

    this.hashes.set(normalizedKey, hash.toLowerCase());

    // Simulate a blockchain transaction hash.
    const txHash = `0x${randomBytes(32).toString("hex")}`;

    return txHash;
  }
}

module.exports = {
  FakeAdapter,
  ZERO_HASH,
};
