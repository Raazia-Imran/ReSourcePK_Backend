const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const crypto = require("node:crypto");
const { corsOrigins, env } = require("./config/env");
const { query } = require("./db");

const authRoutes = require("./routes/authRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const sellerRequestRoutes = require("./routes/sellerRequestRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const workspaceDataRoutes = require("./routes/workspaceDataRoutes");
const { AppError } = require("./lib/errors");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

const app = express();
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use((req, res, next) => {
  req.correlationId = crypto.randomUUID();
  res.set("x-request-id", req.correlationId);
  next();
});
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
app.use(
  express.json({
    limit: "256kb",
    verify(req, _res, buffer) {
      if (req.path === "/api/v1/rapidgateway/webhook")
        req.rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/ready", async (_req, res) => {
  await query("SELECT 1");
  res.json({ status: "ready" });
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", organizationRoutes);
app.use("/api/v1", catalogRoutes);
app.use("/api/v1", maintenanceRoutes);
app.use("/api/v1", sellerRequestRoutes);
app.use("/api/v1", purchaseRoutes);
app.use("/api/v1", workspaceDataRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
