
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const STATUS = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");
const ERROR_CODES = require("../constants/errorCodes");

const protect = (role = "user") => async (req, res, next) => {
  // Preserve the existing cookie selection logic


  const cookieName = role === "admin" ? "token" : "accessToken";

  const token = req.cookies?.[cookieName];

  if (!token) {
    return res.status(STATUS.UNAUTHORIZED).json({
      message: MESSAGES.AUTH.NOT_AUTHORIZED_NO_TOKEN_PROVIDED,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Admin authentication
    if (role === "admin") {
      if (!decoded.isAdmin) {
        return res.status(STATUS.FORBIDDEN).json({
          message: MESSAGES.AUTH.ADMIN_ACCESS_REQUIRED,
        });
      }

      req.admin = decoded;
      return next();
    }

    // User authentication
    const userId = decoded.id;

    if (!userId) {
      return res.status(STATUS.UNAUTHORIZED).json({
        message:
          MESSAGES.AUTH.INVALID_TOKEN_STRUCTURE_PLEASE_LOG_IN_AGAIN,
      });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(STATUS.UNAUTHORIZED).json({
        message: MESSAGES.AUTH.USER_NOT_FOUND_PLEASE_LOG_IN_AGAIN,
      });
    }

    if (user.isBlocked) {
      res.clearCookie(cookieName);

      return res.status(STATUS.FORBIDDEN).json({
        code: ERROR_CODES.USER_BLOCKED,
        message: MESSAGES.AUTH.YOUR_ACCOUNT_HAS_BEEN_BLOCKED,
      });
    }

    req.user = user;
    req.user.id = user._id.toString();

    return next();
  } catch (err) {
    if (role === "user") {
      console.error("Auth verification error:", err.message);

      return res.status(STATUS.UNAUTHORIZED).json({
        message:
          MESSAGES.AUTH.NOT_AUTHORIZED_TOKEN_EXPIRED_OR_INVALID,
      });
    }

    return res.status(STATUS.UNAUTHORIZED).json({
      message: MESSAGES.AUTH.NOT_AUTHORIZED_ADMIN_TOKEN_INVALID,
    });
  }
};

module.exports = { protect };
