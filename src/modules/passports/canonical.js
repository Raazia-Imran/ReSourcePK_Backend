const crypto = require("node:crypto");

/**
 * Converts a JavaScript value into deterministic JSON.
 *
 * Rules:
 * - Object keys are sorted alphabetically.
 * - No unnecessary whitespace.
 * - Array order is preserved.
 * - Only safe integers are accepted as numbers.
 * - Undefined, NaN, Infinity and floating-point numbers are rejected.
 */
function canonicalize(value) {
  function serialize(current, path = "root") {
    // Null
    if (current === null) {
      return "null";
    }

    // Strings and booleans
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }

    // Numbers: only safe integers are allowed
    if (typeof current === "number") {
      if (!Number.isSafeInteger(current)) {
        throw new TypeError(
          `Invalid number at ${path}: only safe integers are allowed`,
        );
      }

      return String(current);
    }

    // Undefined and unsupported primitive types
    if (typeof current !== "object") {
      throw new TypeError(`Unsupported value at ${path}: ${typeof current}`);
    }

    // Arrays: preserve their original order
    if (Array.isArray(current)) {
      return (
        "[" +
        current
          .map((item, index) => {
            if (!(index in current)) {
              throw new TypeError(
                `Undefined array element at ${path}[${index}]`,
              );
            }

            return serialize(item, `${path}[${index}]`);
          })
          .join(",") +
        "]"
      );
    }

    // Only ordinary objects are accepted
    const prototype = Object.getPrototypeOf(current);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Unsupported object at ${path}`);
    }

    // Preserve deterministic UTF-16 ordering; locale-dependent sorting would change hashes.
    const keys = Object.keys(current).sort((left, right) =>
      left < right ? -1 : Number(left > right),
    );

    const properties = keys.map((key) => {
      const propertyValue = current[key];

      if (propertyValue === undefined) {
        throw new TypeError(`Undefined value at ${path}.${key}`);
      }

      return (
        JSON.stringify(key) + ":" + serialize(propertyValue, `${path}.${key}`)
      );
    });

    return "{" + properties.join(",") + "}";
  }

  return serialize(value);
}

/**
 * Generates a lowercase SHA-256 hash from canonical JSON text.
 */
function hashPassport(canonicalString) {
  if (typeof canonicalString !== "string") {
    throw new TypeError("Canonical input must be a string");
  }

  return crypto
    .createHash("sha256")
    .update(canonicalString, "utf8")
    .digest("hex");
}

module.exports = {
  canonicalize,
  hashPassport,
};
