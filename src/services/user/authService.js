// src/services/authService.js
const User = require('../../models/user');
const OTP = require('../../models/otp');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const sendEmail = require('../../utils/sendEmail');
const {
  generateAccessToken,
  generateRefreshToken,
  generateResetToken,
  verifyRefreshToken,
  verifyResetToken,
} = require('../../utils/jwt');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Internal Helper: OTP creation & dispatch
const createAndSendOtp = async (user, type, emailSubject) => {
  await OTP.deleteMany({ userId: user._id, type });

  const otp = Math.floor(Math.random() * 900000) + 100000;
  const otpDoc = await OTP.create({ userId: user._id, otp, type });

  try {
    await sendEmail({
      to: user.email,
      subject: emailSubject,
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });
  } catch (mailErr) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError("Failed to send OTP, please try again", 500);
  }

  return {
    expiresAt: new Date(otpDoc.createdAt.getTime() + 5 * 60 * 1000),
  };
};

// 1. Signup
const signup = async ({ username, email, password }) => {
  const userExists = await User.findOne({ email });
  if (userExists) {
    if (userExists.isVerified) {
      throw createError("User already exists", 400);
    }
    await User.deleteOne({ email });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
  });

  return {
    _id: user._id,
    username: user.username,
  };
};

// 2. Google OAuth
const googleAuth = async (token) => {
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw createError("Invalid Google token", 401);
  }

  const { sub: googleId, email, name, picture } = ticket.getPayload();

  let user = await User.findOne({ googleId });
  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      user.googleId = googleId;
      if (!user.profileImage) user.profileImage = picture;
      await user.save();
    } else {
      user = await User.create({
        username: name,
        email,
        googleId,
        profileImage: picture,
        isVerified: true,
        termsAccepted: true,
      });
    }
  }

  if (user.isBlocked) {
    throw createError("Your account has been blocked", 403);
  }

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      username: user.username,
      email: user.email,
      profileImage: user.profileImage,
    },
  };
};

// 3. Login
const login = async ({ email, password }) => {
  const user = await User.findOne({ email });
  if (!user || !user.isVerified) {
    throw createError("Not registered. Register first to login", 400);
  }

  if (user.isBlocked) {
    throw createError("User is blocked", 401);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw createError("Invalid credentials", 401);
  }

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      username: user.username,
      email: user.email,
    },
  };
};

// 4. Send Signup OTP
const sendOtp = async (email) => {
  const user = await User.findOne({ email });
  if (!user) throw createError("User does not exist", 400);

  return await createAndSendOtp(user, "signup", "Your Signup OTP");
};

// 5. Verify Signup OTP
const verifyOtp = async ({ email, otp }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError("User does not exist", 400);

  const otpExists = await OTP.findOne({ userId: user._id, otp, type: "signup" });
  if (!otpExists) throw createError("OTP wrong", 400);

  if (Date.now() - otpExists.createdAt.getTime() > 5 * 60 * 1000) {
    throw createError("OTP expired", 400);
  }

  user.isVerified = true;
  await user.save();
  await OTP.deleteOne({ _id: otpExists._id });

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      username: user.username,
      email: user.email,
    },
  };
};

// 6. Forgot Password (Send Reset OTP)
const forgotPassword = async (email) => {
  const user = await User.findOne({ email });
  if (!user) throw createError("User does not exist", 400);

  return await createAndSendOtp(user, "reset", "Your Password Reset OTP");
};

// 7. Verify Reset OTP -> Issues resetToken
const verifyResetOtp = async ({ email, otp }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError("User does not exist", 400);

  const otpExists = await OTP.findOne({ userId: user._id, otp, type: "reset" });
  if (!otpExists) throw createError("Invalid OTP", 400);

  if (Date.now() - otpExists.createdAt.getTime() > 5 * 60 * 1000) {
    throw createError("OTP expired", 400);
  }

  await OTP.deleteOne({ _id: otpExists._id });

  const resetToken = generateResetToken(user._id);
  return { resetToken };
};

// 8. Reset Password via resetToken
const resetPassword = async ({ resetToken, newPassword }) => {
  let payload;
  try {
    payload = verifyResetToken(resetToken);
  } catch (err) {
    throw createError(err.message || "Reset link expired or invalid, please try again", 400);
  }

  const user = await User.findById(payload.id);
  if (!user) throw createError("User does not exist", 400);

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  await user.save();

  return true;
};

// 9. Resend OTP
const resendOtp = async ({ email, type }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError("User does not exist", 400);

  if (type === "signup" && user.isVerified) {
    throw createError("User is already verified", 400);
  }

  const subject = type === "signup" ? "Your Signup OTP" : "Your Password Reset OTP";
  return await createAndSendOtp(user, type, subject);
};

// 10. Refresh Access Token (Rotation on 401)
const refreshAccessToken = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    throw createError("No refresh token provided", 401);
  }

  let payload;
  try {
    payload = verifyRefreshToken(incomingRefreshToken);
  } catch (err) {
    throw createError("Refresh token expired or invalid, please login again", 401);
  }

  const user = await User.findById(payload.id);
  if (!user || user.isBlocked) {
    throw createError("User not found or blocked", 401);
  }

  const newAccessToken = generateAccessToken(user._id);
  return { newAccessToken };
};

module.exports = {
  signup,
  googleAuth,
  login,
  sendOtp,
  verifyOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendOtp,
  refreshAccessToken,
};