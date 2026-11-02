
const createError = require("../utils/createError");
const STATUS = require("../constants/statusCodes");

const notFoundMiddleware = (req, res, next) => {
  next(
    createError(
      `Route not found: ${req.originalUrl}`,
      STATUS.NOT_FOUND,
      "ROUTE_NOT_FOUND"
    )
  );
};

module.exports = notFoundMiddleware;
