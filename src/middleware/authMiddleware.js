const jwt = require('jsonwebtoken');
const User = require('../models/user');

const protect = async (req, res, next) => {
  // Remember which cookie the token came from, so a blocked user's
  // response only clears that cookie and never another session's.
  const cookieName = req.cookies?.accessToken ? 'accessToken' : 'token';
  const token = req.cookies?.[cookieName];

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject tokens without a user id (such as admin tokens)
    const userId = decoded.id;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid token structure, please log in again' });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found, please log in again' });
    }

    // 403 (not 401) so the frontend interceptor shows the blocked modal
    // instead of trying the refresh flow.
    if (user.isBlocked) {
      // Pass the same options you used when setting the cookie (path, sameSite, secure)
      res.clearCookie(cookieName);
      return res.status(403).json({
        code: 'USER_BLOCKED',
        message: 'Your account has been blocked',
      });
    }

    // Attach both ._id and .id so controllers accessing either will work seamlessly
    req.user = user;
    req.user.id = user._id.toString();

    next();
  } catch (err) {
    console.error('Auth verification error:', err.message);
    return res.status(401).json({ message: 'Not authorized, token expired or invalid' });
  }
};

const adminProtect = async (req, res, next) => {
  const token = req.cookies?.token || req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, admin token invalid' });
  }
};

module.exports = { protect, adminProtect };
