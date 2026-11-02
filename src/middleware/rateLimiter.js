const rateLimit = require("express-rate-limit");

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,           // 30 requests per window
  message: {
    message: "Too many search requests. Please try again later.",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

module.exports = { searchLimiter };