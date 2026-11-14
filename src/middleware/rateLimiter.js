const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,           // 30 requests per window
  message: {
    message: "Too many search requests. Please try again later.",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Login / OTP protection.
// Without these, anyone could try every possible 6-digit OTP (or many passwords) in a loop.
// Note: if the app is ever deployed behind a proxy / load balancer, add
//   app.set('trust proxy', 1);
// in server.js, otherwise every visitor looks like the same IP address.
// ---------------------------------------------------------------------------
const tooMany = (message) => ({ success: false, message, error: { code: "TOO_MANY_REQUESTS", message } });

// Same email (or IP when there is no email) counts together, so changing IP does not reset the counter.
const emailOrIpKey = (req) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
};

// Login, signup, Google login: 20 tries / 15 min per IP. Successful requests are not counted.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: tooMany("Too many attempts. Please try again in a few minutes."),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Checking an OTP / reset OTP: 5 wrong tries / 15 min per email.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: emailOrIpKey,
  message: tooMany("Too many incorrect OTP attempts. Please wait 15 minutes and request a new OTP."),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Sending / re-sending OTP emails: 5 / 10 min per email (stops inbox flooding and email-quota abuse).
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: emailOrIpKey,
  message: tooMany("Too many OTP requests. Please wait a few minutes and try again."),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Admin login: 10 tries / 15 min per IP. Successful logins are not counted.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: tooMany("Too many login attempts. Please try again later."),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

module.exports = {
  searchLimiter,
  authLimiter,
  otpVerifyLimiter,
  otpSendLimiter,
  adminLoginLimiter,
};
