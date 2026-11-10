const STATUS = require('../constants/statusCodes');
const ERROR_CODES = require('../constants/errorCodes');
const createError = (message, statusCode = STATUS.BAD_REQUEST, code = ERROR_CODES.BAD_REQUEST) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

module.exports = createError;
