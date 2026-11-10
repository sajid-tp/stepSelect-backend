const profileService = require('../../services/user/profileService');
const {
  VALIDATION_MESSAGES,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePassword,
  normalizePhone,
  validatePhone,
  validateOtp,
} = require('../../utils/validators');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// Get profile
const getProfile = async (req, res) => {
  const user = await profileService.getProfile(req.user.id);
  return res.status(STATUS.OK).json({ data: user });
};

// Update image
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

// Remove image
const removeProfileImage = async (req, res) => {
  const updatedUser = await profileService.removeProfileImage(req.user.id);
  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.PROFILE_IMAGE_REMOVED_SUCCESSFULLY,
    data: updatedUser,
  });
};

// Update profile
const updateProfile = async (req, res) => {
  const { username, phoneNumber } = req.body;

  const error = validateUsername(username, 'Name') || validatePhone(phoneNumber);
  if (error) {
    return res.status(STATUS.BAD_REQUEST).json({ message: error });
  }

  const trimmedPhone = normalizePhone(phoneNumber);

  const updatedUser = await profileService.updateProfile(req.user.id, {
    username: username.trim(),
    phoneNumber: trimmedPhone,
  });

  return res.status(STATUS.OK).json({ data: updatedUser });
};

// Change email
const changeEmail = async (req, res) => {
  const formattedEmail = normalizeEmail(req.body.newEmail);

  const error = validateEmail(formattedEmail);
  if (error) {
    return res.status(STATUS.BAD_REQUEST).json({ message: error });
  }

  const result = await profileService.requestEmailChangeOtp(req.user.id, formattedEmail);

  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.VERIFICATION_OTP_SENT_TO_YOUR_NEW_EMAIL,
    expiresAt: result.expiresAt,
  });
};

// Verify email
const verifyChangeEmailOtp = async (req, res) => {
  const error = validateOtp(req.body.otp);
  if (error) {
    return res.status(STATUS.BAD_REQUEST).json({ message: error });
  }

  const otpValue = String(req.body.otp).trim();
  const updatedUser = await profileService.verifyAndChangeEmail(req.user.id, otpValue);

  return res.status(STATUS.OK).json({
    message: MESSAGES.USER.EMAIL_UPDATED_SUCCESSFULLY,
    data: updatedUser,
  });
};

// Change password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.COMMON.PLEASE_FILL_ALL_THE_FIELDS });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(STATUS.BAD_REQUEST).json({ message: passwordError });
  }

  if (newPassword !== confirmPassword) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.USER.NEW_PASSWORD_AND_CONFIRM_PASSWORD_DO_NOT_MATCH,
    });
  }

  if (newPassword === currentPassword) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.USER.NEW_PASSWORD_MUST_BE_DIFFERENT_FROM_CURRENT_PASSWORD,
    });
  }

  await profileService.changePassword(req.user.id, currentPassword, newPassword);

  return res.status(STATUS.OK).json({ message: MESSAGES.USER.PASSWORD_CHANGED_SUCCESSFULLY });
};

module.exports = {
  getProfile,
  updateProfileImage,
  removeProfileImage,
  changeEmail,
  verifyChangeEmailOtp,
  updateProfile,
  changePassword,
};
