// src/controllers/user/authController.js
const authService = require('../../services/user/authService');
const { sendTokenCookies, clearTokenCookies } = require('../../utils/jwt');

// 1. Signup
const signup = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Please fill all the fields" });
    }

    const usernameRegex = /^.{6,10}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ message: "Username should be 6 characters" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    const passwordRegex = /^.{6,15}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ message: "Password should be 6 characters" });
    }

    const user = await authService.signup({ username, email, password });
    return res.status(201).json(user);
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Error please send again" });
  }
};

// 2. Google Login/Signup
const google = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    const { accessToken, refreshToken, user } = await authService.googleAuth(token);
    sendTokenCookies(res, accessToken, refreshToken);

    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
  }
};

// 3. Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    const { accessToken, refreshToken, user } = await authService.login({ email, password });
    sendTokenCookies(res, accessToken, refreshToken);

    return res.status(200).json(user);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || "Login failed" });
  }
};

// 4. Refresh Token (Invoked on frontend 401)
const refreshToken = async (req, res) => {
  try {
    const incomingRefreshToken = req.cookies?.refreshToken;
    const { newAccessToken } = await authService.refreshAccessToken(incomingRefreshToken);

    // Send only the newly minted access token cookie
    sendTokenCookies(res, newAccessToken);

    return res.status(200).json({ message: "Access token refreshed" });
  } catch (err) {
    // If the 7-day refresh token expired, purge cookies so the user re-authenticates
    clearTokenCookies(res);
    return res.status(err.statusCode || 401).json({ message: err.message || "Session expired" });
  }
};

// 5. Logout
const logout = (req, res) => {
  clearTokenCookies(res);
  return res.status(200).json({ message: 'Logged out successfully' });
};

// 6. Send Signup OTP
const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const result = await authService.sendOtp(email);
    return res.status(200).json({
      message: "sent successfully",
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || "send otp again" });
  }
};

// 7. Verify Signup OTP
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP required" });

    const { accessToken, refreshToken, user } = await authService.verifyOtp({ email, otp });
    sendTokenCookies(res, accessToken, refreshToken);

    return res.status(200).json(user);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || "Error request" });
  }
};

// 8. Forgot Password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Please enter your email" });

    const result = await authService.forgotPassword(email);
    return res.status(200).json({
      message: "OTP sent successfully",
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || "Something went wrong" });
  }
};

// 9. Verify Reset OTP
const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Please enter email and OTP" });

    const result = await authService.verifyResetOtp({ email, otp });
    return res.status(200).json({
      message: "OTP verified successfully",
      resetToken: result.resetToken,
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || "Something went wrong" });
  }
};

// 10. Reset Password
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: "Please provide reset token and new password" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    await authService.resetPassword({ resetToken, newPassword });
    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || "Something went wrong" });
  }
};

// 11. Resend OTP
const resendOtp = async (req, res) => {
  try {
    const { email, type } = req.body;

    if (!email || !type) {
      return res.status(400).json({ message: "Please provide email and OTP type" });
    }

    if (type !== "signup" && type !== "reset") {
      return res.status(400).json({ message: "Invalid OTP type" });
    }

    const result = await authService.resendOtp({ email, type });
    return res.status(200).json({
      message: "OTP resent successfully",
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to resend OTP" });
  }
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