
/**
 * Builds the public, privacy-safe data payload for a passport.
 *
 * @param {Object} params
 * @param {string} params.passportId - ID of the passport snapshot
 * @param {number} params.version - Passport version
 * @param {Object} params.order - Completed order database record
 * @param {Object} params.listing - Listing database record
 */
function buildPassportPayload({
  passportId,
  version,
  order,
  listing,
}) {
  // We will add validation and payload construction here.
    if (!passportId || typeof passportId !== "string") {
    throw new TypeError("A valid passportId is required");
  }

  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("Passport version must be a positive integer");
  }

  if (!order || !listing) {
    throw new TypeError("Order and listing records are required");
  }

  if (!order.completed_at) {
    throw new Error("Cannot create a passport for an incomplete order");
  }

    // Convert quantity into a fixed three-decimal string.
  const quantity = String(order.quantity);

  if (!/^\d+\.\d{3}$/.test(quantity)) {
    throw new TypeError(
      "Order quantity must have exactly three decimal places"
    );
  }

  // Convert completion timestamp into UTC ISO format.
  const completedAt = new Date(order.completed_at);

  if (Number.isNaN(completedAt.getTime())) {
    throw new TypeError("Invalid order completion timestamp");
  }

    const payload = {
    schemaVersion: 1,
    passportId,
    version,
    orderId: order.id,
    listingId: order.listing_id,
    materialCategory: listing.material,
    composition: listing.composition,
    colour: listing.color,
    condition: listing.condition,
    quantity,
    unit: order.unit,
    completedAt: completedAt.toISOString(),
  };

  return payload;
}

module.exports = {
  buildPassportPayload,
};
