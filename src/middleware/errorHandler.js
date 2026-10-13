// src/middleware/errorHandler.js
// Central error handler. Anything thrown in a route, controller or service
// (usually with createError) ends up here, and this is the ONLY place that
// decides what the client receives.
const STATUS = require('../constants/statusCodes');
const MESSAGES = require('../constants/messages');
const ERROR_CODES = require('../constants/errorCodes');

// Express recognises an error handler by its 4 parameters, so keep all four
// even though `next` is only used in one branch.
const errorHandler = (err, req, res, next) => {
  // Errors made with createError carry a statusCode. Anything else is unexpected.
  const isKnown = Boolean(err.statusCode);
  const statusCode = isKnown ? err.statusCode : STATUS.SERVER_ERROR;

  // Log only what a developer needs to look at (unexpected errors and 5xx)
  if (!isKnown || statusCode >= STATUS.SERVER_ERROR) console.error(err);

  // If the response already started, let Express close the connection
  if (res.headersSent) return next(err);

  const code = isKnown ? err.code || ERROR_CODES.BAD_REQUEST : ERROR_CODES.SERVER_ERROR;
  // Never leak internal details of unexpected errors to the client
  const message = isKnown ? err.message : MESSAGES.COMMON.SOMETHING_WENT_WRONG;

  return res.status(statusCode).json({
    success: false,
    message, // read by screens that use response.data.message
    error: { code, message }, // read by screens that use response.data.error
  });
};

module.exports = errorHandler;
