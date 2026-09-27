class AppError extends Error {
  statusCode;
  code;
  details;

  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) =>
  new AppError(400, "BAD_REQUEST", message, details);

const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

const forbidden = (message = "You are not allowed to perform this action") =>
  new AppError(403, "FORBIDDEN", message);

const notFound = (message = "Resource not found") =>
  new AppError(404, "NOT_FOUND", message);

const conflict = (message) =>
  new AppError(409, "CONFLICT", message);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
