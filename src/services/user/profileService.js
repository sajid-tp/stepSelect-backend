// src/services/profileService.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../../models/user');
const OTP = require('../../models/otp');
const cloudinary = require('../../config/cloudinary');
const sendEmail = require('../../utils/sendEmail');

const OTP_TTL_MS = 5 * 60 * 1000;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const otpCreatedAt = (doc) => doc.createdAt || doc._id.getTimestamp();


const getProfile = async (userId) => {
  const user = await User.findById(userId).select(
    'username email profileImage phoneNumber googleId password'
  );

  if (!user) {
    throw createError('User not found', 404);
  }

  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    profileImage: user.profileImage,
    phoneNumber: user.phoneNumber,
    isGoogleUser: Boolean(user.googleId),
  };
};



const updateProfileImage = async (userId, file) => {
  const fileStr = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

  const result = await cloudinary.uploader.upload(fileStr, {
    folder: 'stepSelect/profile_pictures',
  });

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { profileImage: result.secure_url },
    { new: true }
  ).select('-password');

  if (!updatedUser) {
    throw createError('User not found', 404);
  }

  return updatedUser;
};


const updateProfile = async (userId, { username, phoneNumber }) => {
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { username, phoneNumber },
    { new: true, runValidators: true }
  ).select('username profileImage email phoneNumber');

  if (!updatedUser) {
    throw createError('User not found', 404);
  }

  return updatedUser;
};


const requestEmailChangeOtp = async (userId, newEmail) => {
  const currentUser = await User.findById(userId);
  if (!currentUser) {
    throw createError('User not found', 404);
  }

  if (currentUser.email.toLowerCase() === newEmail) {
    throw createError('New email cannot be the same as current email', 400);
  }

  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser) {
    throw createError('Email is already in use by another account', 400);
  }

  await OTP.deleteMany({ userId: currentUser._id, type: 'change_email' });

  const otp = crypto.randomInt(100000, 1000000);

  const otpDoc = await OTP.create({
    userId: currentUser._id,
    otp,
    type: 'change_email',
    newEmail,
  });

  try {
    await sendEmail({
      to: newEmail,
      subject: 'Verify Your New Email Address',
      html: `<p>Your email change verification code is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });
  } catch (mailErr) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError('Failed to send verification email, please try again', 500);
  }

  return {
    expiresAt: new Date(otpCreatedAt(otpDoc).getTime() + OTP_TTL_MS),
  };
};


const verifyAndChangeEmail = async (userId, otpValue) => {

  
const currentUser = await User.findById(userId);

if (!currentUser) {
  throw createError('User not found', 404);
}

if (currentUser.googleId) {
  throw createError(
    'Email changes are unavailable for Google-linked accounts',
    403
  );
}

  const otpDoc = await OTP.findOne({
    userId,
    otp: Number(otpValue),
    type: 'change_email',
  });

  if (!otpDoc) {
    throw createError('Invalid OTP', 400);
  }

  const otpAge = Date.now() - otpCreatedAt(otpDoc).getTime();
  if (otpAge > OTP_TTL_MS) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError('OTP expired', 400);
  }

  const emailTaken = await User.findOne({ email: otpDoc.newEmail, _id: { $ne: userId } });
  if (emailTaken) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError('Email is already in use by another account', 400);
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { email: otpDoc.newEmail },
    { new: true }
  ).select('-password');

  await OTP.deleteOne({ _id: otpDoc._id });

  return updatedUser;
};


const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId);
  if (!user) {
    throw createError('User does not exist', 400);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    throw createError('Current password is incorrect', 401);
  }

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) {
    throw createError('New password must be different from current password', 400);
  }

  
if (user.googleId) {
  throw createError(
    'Password changes are unavailable for Google-linked accounts',
    403
  );
}


  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  return true;
};

module.exports = {
  getProfile,
  updateProfileImage,
  updateProfile,
  requestEmailChangeOtp,
  verifyAndChangeEmail,
  changePassword,
};