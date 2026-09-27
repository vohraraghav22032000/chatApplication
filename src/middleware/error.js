const {  NextFunction, Request, Response  } = require("express");
const {  ZodError  } = require("zod");
const {  AppError  } = require("../utils/errors");

function errorHandler(
  error,
  _req,
  res,
  _next
) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() }
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details }
    });
  }

  console.error(error);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" }
  });
}

module.exports = { errorHandler };
