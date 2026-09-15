exports.protect = (req, res, next) => {
  // Check for JWT token in headers
  next();
};