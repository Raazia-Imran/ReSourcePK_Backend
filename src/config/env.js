const { z } = require("zod");
require("dotenv").config();

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  PUBLIC_READS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(10)
    .max(10000)
    .default(300),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().min(16).optional(),
  EMAIL_FROM_NAME: z.string().default("ReSource PK"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  LISTING_IMAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,62}$/)
    .optional(),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  const fields = result.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  throw new Error(`Invalid environment configuration: ${fields}`);
}

if (
  (result.data.GMAIL_USER && !result.data.GMAIL_APP_PASSWORD) ||
  (!result.data.GMAIL_USER && result.data.GMAIL_APP_PASSWORD)
) {
  throw new Error(
    "GMAIL_USER and GMAIL_APP_PASSWORD must be configured together",
  );
}

const storageValues = [
  result.data.SUPABASE_URL,
  result.data.SUPABASE_SERVICE_ROLE_KEY,
  result.data.LISTING_IMAGE_BUCKET,
];
if (storageValues.some(Boolean) && !storageValues.every(Boolean)) {
  throw new Error(
    "Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and LISTING_IMAGE_BUCKET together",
  );
}
if (
  result.data.NODE_ENV === "production" &&
  result.data.SUPABASE_URL &&
  !result.data.SUPABASE_URL.startsWith("https://")
) {
  throw new Error("Production storage requires HTTPS");
}
if (result.data.NODE_ENV === "production") {
  if (
    /^(replace|your-|test-|ci-only|integration-only)/i.test(
      result.data.JWT_ACCESS_SECRET,
    )
  )
    throw new Error("Replace the placeholder JWT secret before production");
  if (
    !result.data.APP_URL.startsWith("https://") ||
    result.data.CORS_ORIGINS.split(",").some(
      (origin) => !origin.trim().startsWith("https://"),
    )
  )
    throw new Error("Production application and CORS origins require HTTPS");
}

module.exports = {
  env: result.data,
  corsOrigins: result.data.CORS_ORIGINS.split(",").map((origin) =>
    origin.trim(),
  ),
};
