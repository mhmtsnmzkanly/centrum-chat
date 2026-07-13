export class ContractUnavailableError extends Error {
  constructor(
    message =
      "This backend administration/moderation capability is not supported by the current contract.",
  ) {
    super(message);
    this.name = "ContractUnavailableError";
    this.code = "CONTRACT_UNAVAILABLE";
  }
}

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION_ERROR";
    this.details = details;
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
    this.code = "UNAUTHORIZED";
  }
}

export class ForbiddenError extends Error {
  constructor(
    message = "You do not have administrative or moderation permissions.",
  ) {
    super(message);
    this.name = "ForbiddenError";
    this.code = "FORBIDDEN";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
    this.code = "NOT_FOUND";
  }
}

export class ConflictError extends Error {
  constructor(
    message =
      "A conflict occurred. The resource may have been updated by another operator.",
  ) {
    super(message);
    this.name = "ConflictError";
    this.code = "CONFLICT";
  }
}

export class RateLimitError extends Error {
  constructor(
    message = "Too many operations. Please try again later.",
    retryAfter = null,
  ) {
    super(message);
    this.name = "RateLimitError";
    this.code = "RATE_LIMIT";
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends Error {
  constructor(message = "An internal server error occurred.") {
    super(message);
    this.name = "ServerError";
    this.code = "SERVER_ERROR";
  }
}

export class NetworkError extends Error {
  constructor(
    message = "A network error occurred. Please check your connection.",
  ) {
    super(message);
    this.name = "NetworkError";
    this.code = "NETWORK_ERROR";
  }
}
