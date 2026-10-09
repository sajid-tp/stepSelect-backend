// Small helper so services can throw errors that carry an HTTP status + a code.
// The controllers read err.statusCode and err.code to build the response.
const createError = (message, statusCode = 400, code = 'BAD_REQUEST') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

module.exports = createError;
