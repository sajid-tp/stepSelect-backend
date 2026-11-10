const STATUS = require('../constants/statusCodes');
const MESSAGES = require('../constants/messages');
const ERROR_CODES = require('../constants/errorCodes');


const errorHandler = (err, req, res, next) => {

  const isKnown = Boolean(err.statusCode);
  const statusCode = isKnown ? err.statusCode : STATUS.SERVER_ERROR;

  if (!isKnown || statusCode >= STATUS.SERVER_ERROR) console.error(err);

  if (res.headersSent) return next(err);

  const code = isKnown ? err.code || ERROR_CODES.BAD_REQUEST : ERROR_CODES.SERVER_ERROR;
  const message = isKnown ? err.message : MESSAGES.COMMON.SOMETHING_WENT_WRONG;

  return res.status(statusCode).json({
    success: false,
    message,
    error: { code, message },
  });
};

module.exports = errorHandler;
