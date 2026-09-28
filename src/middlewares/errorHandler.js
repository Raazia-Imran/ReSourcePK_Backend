const { ZodError } = require("zod");
const { AppError } = require("../lib/errors");

function notFound(req, _res, next) {
  next(
    new AppError(404, "NOT_FOUND", `No route for ${req.method} ${req.path}`),
  );
}

function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the submitted fields",
        details: error.flatten().fieldErrors,
        correlationId: req.correlationId,
      },
    });
  }
  const status = error.status || 500;
  if (status >= 500) {
    console.error("Unhandled request error", {
      correlationId: req.correlationId,
      error,
    });
  }
  return res.status(status).json({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message:
        status >= 500
          ? "The server could not complete this request"
          : error.message,
      correlationId: req.correlationId,
    },
  });
}

module.exports = { notFound, errorHandler };
