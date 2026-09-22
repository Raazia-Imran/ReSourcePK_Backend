// src/routes/auth.routes.js
const express = require("express");
const router = express.Router();
const validateSignupInput = require("../middlewares/validateSignup");
const { signupController } = require("../controllers/auth.controller");

router.post("/signup", validateSignupInput, signupController);

module.exports = router;