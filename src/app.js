const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { corsOrigins } = require("./config/env");
const { query } = require("./db");

const authRoutes = require("./routes/authRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const { AppError } = require("./lib/errors");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(
        new AppError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed"),
      );
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  req.correlationId = req.get("x-request-id") || crypto.randomUUID();
  res.set("x-request-id", req.correlationId);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/ready", async (_req, res) => {
  await query("SELECT 1");
  res.json({ status: "ready" });
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", organizationRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
