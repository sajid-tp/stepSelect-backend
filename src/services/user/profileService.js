// src/services/profileService.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../../models/user');
const OTP = require('../../models/otp');
const cloudinary = require('../../config/cloudinary');
const sendEmail = require('../../utils/sendEmail');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const OTP_TTL_MS = 5 * 60 * 1000;



const otpCreatedAt = (doc) => doc.createdAt || doc._id.getTimestamp();


const getProfile = async (userId) => {
  const user = await User.findById(userId).select(
    'username email profileImage phoneNumber googleId password'
  );

  if (!user) {
    throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND);
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
    throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND);
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
    throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND);
  }

  return updatedUser;
};


const requestEmailChangeOtp = async (userId, newEmail) => {
  const currentUser = await User.findById(userId);
  if (!currentUser) {
    throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND);
  }

  if (currentUser.email.toLowerCase() === newEmail) {
    throw createError(MESSAGES.USER.NEW_EMAIL_CANNOT_BE_THE_SAME_AS_CURRENT, STATUS.BAD_REQUEST);
  }

  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser) {
    throw createError(MESSAGES.USER.EMAIL_IS_ALREADY_IN_USE_BY_ANOTHER_ACCOUNT, STATUS.BAD_REQUEST);
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
    throw createError(MESSAGES.USER.FAILED_TO_SEND_VERIFICATION_EMAIL_PLEASE_TRY_AGAIN, STATUS.SERVER_ERROR);
  }

  return {
    expiresAt: new Date(otpCreatedAt(otpDoc).getTime() + OTP_TTL_MS),
  };
};


const verifyAndChangeEmail = async (userId, otpValue) => {

  
const currentUser = await User.findById(userId);

if (!currentUser) {
  throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND);
}

if (currentUser.googleId) {
  throw createError(
    MESSAGES.USER.EMAIL_CHANGES_ARE_UNAVAILABLE_FOR_GOOGLE_LINKED_ACCOUNTS,
    STATUS.FORBIDDEN
  );
}

  const otpDoc = await OTP.findOne({
    userId,
    otp: Number(otpValue),
    type: 'change_email',
  });

  if (!otpDoc) {
    throw createError(MESSAGES.AUTH.INVALID_OTP, STATUS.BAD_REQUEST);
  }

  const otpAge = Date.now() - otpCreatedAt(otpDoc).getTime();
  if (otpAge > OTP_TTL_MS) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError(MESSAGES.AUTH.OTP_EXPIRED, STATUS.BAD_REQUEST);
  }

  const emailTaken = await User.findOne({ email: otpDoc.newEmail, _id: { $ne: userId } });
  if (emailTaken) {
    await OTP.deleteOne({ _id: otpDoc._id });
    throw createError(MESSAGES.USER.EMAIL_IS_ALREADY_IN_USE_BY_ANOTHER_ACCOUNT, STATUS.BAD_REQUEST);
  }

  let updatedUser;
  try {
    updatedUser = await User.findByIdAndUpdate(
      userId,
      { email: otpDoc.newEmail },
      { new: true }
    ).select('-password');
  } catch (err) {
    // 11000 = unique email index: another account took this email in the meantime
    if (err.code === 11000) {
      throw createError(MESSAGES.USER.EMAIL_IS_ALREADY_IN_USE_BY_ANOTHER_ACCOUNT, STATUS.BAD_REQUEST);
    }
    throw err;
  }

  await OTP.deleteOne({ _id: otpDoc._id });

  return updatedUser;
};


const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId);
  if (!user) {
    throw createError(MESSAGES.USER.USER_DOES_NOT_EXIST, STATUS.BAD_REQUEST);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    throw createError(MESSAGES.USER.CURRENT_PASSWORD_IS_INCORRECT, STATUS.UNAUTHORIZED);
  }

  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) {
    throw createError(MESSAGES.USER.NEW_PASSWORD_MUST_BE_DIFFERENT_FROM_CURRENT_PASSWORD, STATUS.BAD_REQUEST);
  }

  
if (user.googleId) {
  throw createError(
    MESSAGES.USER.PASSWORD_CHANGES_ARE_UNAVAILABLE_FOR_GOOGLE_LINKED_ACCOUNTS,
    STATUS.FORBIDDEN
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