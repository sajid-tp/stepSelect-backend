// src/constants/statusCodes.js
// HTTP status codes used across the whole backend.
// Object.freeze makes it behave like an enum: values cannot be changed or added at runtime.
const STATUS = Object.freeze({
  // Success
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,

  // Client errors
  BAD_REQUEST: 400,          // invalid input / validation failed
  UNAUTHORIZED: 401,         // not logged in / invalid or expired token
  FORBIDDEN: 403,            // logged in but not allowed (blocked user, not admin)
  NOT_FOUND: 404,            // resource does not exist
  CONFLICT: 409,             // duplicate, out of stock, already exists
  UNPROCESSABLE: 422,        // input is well-formed but cannot be processed
  TOO_MANY_REQUESTS: 429,    // rate limit (OTP resend, login attempts)

  // Server errors
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,  // email / payment provider down
});

module.exports = STATUS;
