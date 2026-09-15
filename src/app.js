const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/v1/auth", authRoutes);

// Health Check
app.get("/", (req, res) => {
  res.send("ReSource PK API is running.");
});

module.exports = app;