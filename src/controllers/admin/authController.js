// src/controllers/admin/authController.js
const adminAuthService = require('../../services/admin/adminAuthServices');

const {
  sendAdminTokenCookie,
  clearAdminTokenCookie,
} = require('../../utils/jwt');

const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

const adminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.ADMIN.EMAIL_AND_PASSWORD_ARE_REQUIRED,
    });
  }

  const { token } = await adminAuthService.loginAdmin(email, password);

  sendAdminTokenCookie(res, token);

  return res.status(STATUS.OK).json({
    message: MESSAGES.ADMIN.LOGIN_SUCCESSFUL,
  });
};

const adminLogout = (req, res) => {
  clearAdminTokenCookie(res);

  return res.status(STATUS.OK).json({
    message: MESSAGES.ADMIN.LOGOUT_SUCCESSFUL,
  });
};

module.exports = {
  adminLogin,
  adminLogout,
};