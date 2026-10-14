const { z } = require("zod");

// Accept decimal text, including numeric import cells, but never round money.
function scaled(value, places) {
  const [whole, fraction = ""] = String(value).split(".");
  return (
    BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"))
  );
}
function decimal(places) {
  const pattern = new RegExp(
    String.raw`^(?:0|[1-9]\d{0,8})(?:\.\d{1,${places}})?$`,
  );
  return z
    .union([z.string(), z.number().finite()])
    .transform(String)
    .refine((value) => pattern.test(value), {
      message: `Use a positive decimal with at most ${places} decimal places`,
      abort: true,
    })
    .refine(
      (value) =>
        pattern.test(value) &&
        scaled(value, places) > 0n &&
        scaled(value, places) <= 100000000n * 10n ** BigInt(places),
      "Value must be between zero and 100,000,000",
    );
}
const money = decimal(2);
const quantity = decimal(3);
const unit = z.enum(["kg", "meter", "roll", "piece"]);
const uuid = z.string().uuid();
const paginationInput = z
  .object({
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const tier = z.object({ minQuantity: quantity, pricePerUnit: money }).strict();
const listingInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(20).max(5000),
    material: z.string().trim().min(2).max(80),
    condition: z.string().trim().min(2).max(80),
    color: z.string().trim().max(80).default(""),
    composition: z.string().trim().max(200).default(""),
    location: z.string().trim().max(180).default(""),
    unit,
    quantity,
    minOrderQuantity: quantity,
    pricePerUnit: money,
    priceTiers: z.array(tier).max(10).default([]),
  })
  .strict()
  .superRefine((data, context) => {
    if (scaled(data.minOrderQuantity, 3) > scaled(data.quantity, 3))
      context.addIssue({
        code: "custom",
        path: ["minOrderQuantity"],
        message: "Minimum order must not exceed available quantity",
      });
    let threshold = scaled(data.minOrderQuantity, 3) - 1n;
    let price = scaled(data.pricePerUnit, 2);
    data.priceTiers.forEach((item, index) => {
      const amount = scaled(item.minQuantity, 3),
        nextPrice = scaled(item.pricePerUnit, 2);
      if (
        amount <= threshold ||
        amount > scaled(data.quantity, 3) ||
        nextPrice > price
      )
        context.addIssue({
          code: "custom",
          path: ["priceTiers", index],
          message:
            "Tiers must increase from MOQ up to available stock, with prices that never increase",
        });
      threshold = amount;
      price = nextPrice;
    });
  });
const requirementInput = z
  .object({
    material: z.string().trim().min(2).max(80),
    minQuantity: quantity,
    unit,
    maxPricePerUnit: money.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
module.exports = {
  scaled,
  money,
  quantity,
  unit,
  uuid,
  paginationInput,
  listingInput,
  requirementInput,
};
