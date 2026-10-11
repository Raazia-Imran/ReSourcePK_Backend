const { ZodError } = require("zod");
const { AppError } = require("../lib/errors");
const multer = require("multer");

function notFound(req, _res, next) {
  next(
    new AppError(404, "NOT_FOUND", `No route for ${req.method} ${req.path}`),
  );
}

function errorHandler(error, req, res, _next) {
  if (error instanceof multer.MulterError)
    return res.status(413).json({
      error: {
        code: "UPLOAD_LIMIT",
        message:
          "Upload exceeded its size, file count or field limits. Stock sheets allow 2 MB; raster images allow 5 MB.",
        correlationId: req.correlationId,
      },
    });
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
      errorName: error.name,
      errorCode:
        typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? error.code
          : "UNCLASSIFIED",
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
      ...(error.details && status < 500 ? { details: error.details } : {}),
    },
  });
}

module.exports = { notFound, errorHandler };
