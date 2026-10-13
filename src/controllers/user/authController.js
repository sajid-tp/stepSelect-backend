// src/controllers/user/authController.js
const authService = require('../../services/user/authService');
const { sendTokenCookies, clearUserTokenCookies } = require('../../utils/jwt');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// 1. Signup
const signup = async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.COMMON.PLEASE_FILL_ALL_THE_FIELDS });
  }

  const usernameRegex = /^.{6,10}$/;
  if (!usernameRegex.test(username)) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.USERNAME_SHOULD_BE_6_CHARACTERS });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.PLEASE_ENTER_A_VALID_EMAIL });
  }

  const passwordRegex = /^.{6,15}$/;
  if (!passwordRegex.test(password)) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PASSWORD_SHOULD_BE_6_CHARACTERS });
  }

  const user = await authService.signup({ username, email, password });
  return res.status(STATUS.CREATED).json(user);
};

// 2. Google Login/Signup
const google = async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.GOOGLE_TOKEN_IS_REQUIRED });
  }

  const { accessToken, refreshToken, user } = await authService.googleAuth(token);
  sendTokenCookies(res, accessToken, refreshToken);

  return res.status(STATUS.OK).json(user);
};

// 3. Login
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PLEASE_FILL_ALL_FIELDS });
  }

  const { accessToken, refreshToken, user } = await authService.login({ email, password });
  sendTokenCookies(res, accessToken, refreshToken);

  return res.status(STATUS.OK).json(user);
};

// 4. Refresh Token (Invoked on frontend 401)
const refreshToken = async (req, res) => {
  try {
    const incomingRefreshToken = req.cookies?.refreshToken;
    const { newAccessToken } = await authService.refreshAccessToken(incomingRefreshToken);

    // Send only the newly minted access token cookie
    sendTokenCookies(res, newAccessToken);

    return res.status(STATUS.OK).json({ message: MESSAGES.AUTH.ACCESS_TOKEN_REFRESHED });
  } catch (err) {
    // If the 7-day refresh token expired, purge cookies so the user re-authenticates
    clearTokenCookies(res);
    // Any failure while refreshing means the session is over, so it is always a 401
    throw err.statusCode ? err : createError(err.message || MESSAGES.AUTH.SESSION_EXPIRED, STATUS.UNAUTHORIZED);
  }
};

// 5. Logout
const logout = (req, res) => {
  clearUserTokenCookies(res);
  return res.status(STATUS.OK).json({ message: MESSAGES.AUTH.LOGGED_OUT_SUCCESSFULLY });
};

// 6. Send Signup OTP
const sendOtp = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.EMAIL_IS_REQUIRED });

  const result = await authService.sendOtp(email);
  return res.status(STATUS.OK).json({
    message: MESSAGES.AUTH.SENT_SUCCESSFULLY,
    expiresAt: result.expiresAt,
  });
};

// 7. Verify Signup OTP
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.EMAIL_AND_OTP_REQUIRED });

  const { accessToken, refreshToken, user } = await authService.verifyOtp({ email, otp });
  sendTokenCookies(res, accessToken, refreshToken);

  return res.status(STATUS.OK).json(user);
};

// 8. Forgot Password
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PLEASE_ENTER_YOUR_EMAIL });

  const result = await authService.forgotPassword(email);
  return res.status(STATUS.OK).json({
    message: MESSAGES.AUTH.OTP_SENT_SUCCESSFULLY,
    expiresAt: result.expiresAt,
  });
};

// 9. Verify Reset OTP
const verifyResetOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PLEASE_ENTER_EMAIL_AND_OTP });

  const result = await authService.verifyResetOtp({ email, otp });
  return res.status(STATUS.OK).json({
    message: MESSAGES.AUTH.OTP_VERIFIED_SUCCESSFULLY,
    resetToken: result.resetToken,
  });
};

// 10. Reset Password
const resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PLEASE_PROVIDE_RESET_TOKEN_AND_NEW_PASSWORD });
  }

  if (newPassword.length < 6) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PASSWORD_MUST_BE_AT_LEAST_6_CHARACTERS });
  }

  await authService.resetPassword({ resetToken, newPassword });
  return res.status(STATUS.OK).json({ message: MESSAGES.AUTH.PASSWORD_RESET_SUCCESSFUL });
};

// 11. Resend OTP
const resendOtp = async (req, res) => {
  const { email, type } = req.body;

  if (!email || !type) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.PLEASE_PROVIDE_EMAIL_AND_OTP_TYPE });
  }

  if (type !== "signup" && type !== "reset") {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.AUTH.INVALID_OTP_TYPE });
  }

  const result = await authService.resendOtp({ email, type });
  return res.status(STATUS.OK).json({
    message: MESSAGES.AUTH.OTP_RESENT_SUCCESSFULLY,
    expiresAt: result.expiresAt,
  });
};

module.exports = {
  signup,
  google,
  login,
  refreshToken,
  logout,
  sendOtp,
  verifyOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendOtp,
};