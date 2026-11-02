// src/controllers/user/profileController.js
const profileService = require('../../services/user/profileService');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// 1. Get Profile
const getProfile = async (req, res) => {
  const user = await profileService.getProfile(req.user.id);
  return res.status(STATUS.OK).json({ data: user });
};

// 2. Update Profile Image
const updateProfileImage = async (req, res) => {
  if (!req.file) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.UPLOAD.NO_FILE_PROVIDED });
  }

  const updatedUser = await profileService.updateProfileImage(req.user.id, req.file);
  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.PROFILE_IMAGE_UPDATED_SUCCESSFULLY,
    data: updatedUser,
  });
};

// 3. Update Name & Phone
const updateProfile = async (req, res) => {
  const { username, phoneNumber } = req.body;

  if (!username || !username.trim()) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.NAME_IS_REQUIRED });
  }

  const trimmedName = username.trim();
  if (trimmedName.length < 6) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.NAME_MUST_BE_AT_LEAST_6_CHARACTERS_LONG });
  }

  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.PHONE_NUMBER_IS_REQUIRED });
  }

  const trimmedPhone = String(phoneNumber).trim();
  const phoneRegex = /^\d{10,15}$/;
  if (!phoneRegex.test(trimmedPhone)) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.USER.PHONE_NUMBER_INVALID,
    });
  }

  const updatedUser = await profileService.updateProfile(req.user.id, {
    username: trimmedName,
    phoneNumber: trimmedPhone,
  });

  return res.status(STATUS.OK).json({ data: updatedUser });
};

// 4. Request Email Change OTP
const changeEmail = async (req, res) => {
  const formattedEmail =
    typeof req.body.newEmail === 'string' ? req.body.newEmail.trim().toLowerCase() : '';

  if (!formattedEmail) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.PLEASE_PROVIDE_THE_NEW_EMAIL });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(formattedEmail)) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.PLEASE_ENTER_A_VALID_EMAIL });
  }

  const result = await profileService.requestEmailChangeOtp(req.user.id, formattedEmail);

  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.VERIFICATION_OTP_SENT_TO_YOUR_NEW_EMAIL,
    expiresAt: result.expiresAt,
  });
};

// 5. Verify Email Change OTP
const verifyChangeEmailOtp = async (req, res) => {
  const otpValue = String(req.body.otp ?? '').trim();
  if (!/^\d{6}$/.test(otpValue)) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.USER.ENTER_A_VALID_6_DIGIT_CODE });
  }

  const updatedUser = await profileService.verifyAndChangeEmail(req.user.id, otpValue);

  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.EMAIL_UPDATED_SUCCESSFULLY,
    data: updatedUser,
  });
};

// 6. Change Password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.COMMON.PLEASE_FILL_ALL_THE_FIELDS });
  }

  const passwordRegex = /^.{6,15}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.USER.PASSWORD_MUST_BE_BETWEEN_6_AND_15_CHARACTERS,
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.USER.NEW_PASSWORD_AND_CONFIRM_PASSWORD_DO_NOT_MATCH,
    });
  }

  await profileService.changePassword(req.user.id, currentPassword, newPassword);

  return res.status(STATUS.OK).json({ message: MESSAGES.USER.PASSWORD_CHANGED_SUCCESSFULLY });
};

module.exports = {
  getProfile,
  updateProfileImage,
  changeEmail,
  verifyChangeEmailOtp,
  updateProfile,
  changePassword,
};