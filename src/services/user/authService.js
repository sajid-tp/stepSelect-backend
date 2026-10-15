// src/services/authService.js
const User = require('../../models/user');
const OTP = require('../../models/otp');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const sendEmail = require('../../utils/sendEmail');
const createError = require('../../utils/createError');
const {
  generateAccessToken,
  generateRefreshToken,
  generateResetToken,
  verifyRefreshToken,
  verifyResetToken,
} = require('../../utils/jwt');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    throw createError(MESSAGES.AUTH.FAILED_TO_SEND_OTP_PLEASE_TRY_AGAIN, STATUS.SERVER_ERROR);
  }

  return {
    expiresAt: new Date(otpDoc.createdAt.getTime() + 5 * 60 * 1000),
  };
};


const signup = async ({ username, email, password }) => {
  const userExists = await User.findOne({ email });
  if (userExists) {
    if (userExists.isVerified) {
      throw createError(MESSAGES.AUTH.USER_ALREADY_EXISTS, STATUS.BAD_REQUEST);
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


const googleAuth = async (token) => {
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw createError(MESSAGES.AUTH.INVALID_GOOGLE_TOKEN, STATUS.UNAUTHORIZED);
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
    throw createError(MESSAGES.AUTH.YOUR_ACCOUNT_HAS_BEEN_BLOCKED, STATUS.FORBIDDEN);
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
    throw createError(MESSAGES.AUTH.NOT_REGISTERED_REGISTER_FIRST_TO_LOGIN, STATUS.BAD_REQUEST);
  }

  if (user.isBlocked) {
    throw createError(MESSAGES.AUTH.USER_IS_BLOCKED, STATUS.UNAUTHORIZED);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw createError(MESSAGES.AUTH.INVALID_CREDENTIALS, STATUS.UNAUTHORIZED);
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
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  return await createAndSendOtp(user, "signup", "Your Signup OTP");
};

// 5. Verify Signup OTP
const verifyOtp = async ({ email, otp }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  const otpExists = await OTP.findOne({ userId: user._id, otp, type: "signup" });
  if (!otpExists) throw createError(MESSAGES.AUTH.OTP_WRONG, STATUS.BAD_REQUEST);

  if (Date.now() - otpExists.createdAt.getTime() > 5 * 60 * 1000) {
    throw createError(MESSAGES.AUTH.OTP_EXPIRED, STATUS.BAD_REQUEST);
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
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  return await createAndSendOtp(user, "reset", "Your Password Reset OTP");
};

// 7. Verify Reset OTP -> Issues resetToken
const verifyResetOtp = async ({ email, otp }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  const otpExists = await OTP.findOne({ userId: user._id, otp, type: "reset" });
  if (!otpExists) throw createError(MESSAGES.AUTH.INVALID_OTP, STATUS.BAD_REQUEST);

  if (Date.now() - otpExists.createdAt.getTime() > 5 * 60 * 1000) {
    throw createError(MESSAGES.AUTH.OTP_EXPIRED, STATUS.BAD_REQUEST);
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
    throw createError(err.message || MESSAGES.AUTH.RESET_LINK_EXPIRED_OR_INVALID_PLEASE_TRY_AGAIN, STATUS.BAD_REQUEST);
  }

  const user = await User.findById(payload.id);
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  await user.save();

  return true;
};

// 9. Resend OTP
const resendOtp = async ({ email, type }) => {
  const user = await User.findOne({ email });
  if (!user) throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);

  if (type === "signup" && user.isVerified) {
    throw createError(MESSAGES.AUTH.USER_IS_ALREADY_VERIFIED, STATUS.BAD_REQUEST);
  }

  const subject = type === "signup" ? "Your Signup OTP" : "Your Password Reset OTP";
  return await createAndSendOtp(user, type, subject);
};

// 10. Refresh Access Token (Rotation on 401)
const refreshAccessToken = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    throw createError(MESSAGES.AUTH.NO_REFRESH_TOKEN_PROVIDED, STATUS.UNAUTHORIZED);
  }

  let payload;
  try {
    payload = verifyRefreshToken(incomingRefreshToken);
  } catch (err) {
    throw createError(MESSAGES.AUTH.REFRESH_TOKEN_EXPIRED_OR_INVALID_PLEASE_LOGIN_AGAIN, STATUS.UNAUTHORIZED);
  }

  const user = await User.findById(payload.id);
  if (!user || user.isBlocked) {
    throw createError(MESSAGES.AUTH.USER_NOT_FOUND_OR_BLOCKED, STATUS.UNAUTHORIZED);
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