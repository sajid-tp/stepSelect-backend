// src/controllers/admin/authController.js
const adminAuthService = require('../../services/admin/adminAuthServices');
const { sendAdminTokenCookie } = require('../../utils/jwt');
const { clearTokenCookies } = require('../../utils/jwt');

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required',
      });
    }

    const { token } = await adminAuthService.loginAdmin(email, password);

    // Set cookie using imported jwt utility
    sendAdminTokenCookie(res, token);

    return res.status(200).json({
      message: 'Login successful',
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Server error',
    });
  }
};

const adminLogout = async (req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';

    // Must match the exact path, secure, and sameSite options used in sendAdminTokenCookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
    });

    return res.status(200).json({ message: 'Logout successful' });
  } catch (error) {
    return res.status(500).json({ message: 'Logout failed' });
  }
};

const checkAdminAuth = async (req, res) => {
  // adminProtect middleware attaches req.admin
  return res.status(200).json({
    isAdmin: true,
    admin: req.admin,
  });
}

module.exports = {
  adminLogin,
  adminLogout,
  checkAdminAuth
};