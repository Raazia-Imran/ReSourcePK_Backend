const { z } = require("zod");
require("dotenv").config();

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().min(16).optional(),
  EMAIL_FROM_NAME: z.string().default("ReSource PK"),
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

module.exports = {
  env: result.data,
  corsOrigins: result.data.CORS_ORIGINS.split(",").map((origin) =>
    origin.trim(),
  ),
};
