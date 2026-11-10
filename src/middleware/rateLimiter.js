const rateLimit = require("express-rate-limit");

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  message: {
    message: "Too many search requests. Please try again later.",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

module.exports = { searchLimiter };