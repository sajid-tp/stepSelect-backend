// src/controllers/user/profileController.js
const profileService = require('../../services/user/profileService');

// 1. Get Profile
const getProfile = async (req, res) => {
  try {
    const user = await profileService.getProfile(req.user.id);
    return res.status(200).json({ data: user });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Server error',
    });
  }
};

// 2. Update Profile Image
const updateProfileImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    const updatedUser = await profileService.updateProfileImage(req.user.id, req.file);
    return res.status(200).json({
      message: 'Profile image updated successfully',
      data: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

// 3. Update Name & Phone
const updateProfile = async (req, res) => {
  try {
    const { username, phoneNumber } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const trimmedName = username.trim();
    if (trimmedName.length < 6) {
      return res.status(400).json({ message: 'Name must be at least 6 characters long' });
    }

    if (!phoneNumber || !String(phoneNumber).trim()) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const trimmedPhone = String(phoneNumber).trim();
    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(trimmedPhone)) {
      return res.status(400).json({
        message: 'Phone number must contain only digits and be at least 10 digits long',
      });
    }

    const updatedUser = await profileService.updateProfile(req.user.id, {
      username: trimmedName,
      phoneNumber: trimmedPhone,
    });

    return res.status(200).json({ data: updatedUser });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Server error',
    });
  }
};

// 4. Request Email Change OTP
const changeEmail = async (req, res) => {
  try {
    const formattedEmail =
      typeof req.body.newEmail === 'string' ? req.body.newEmail.trim().toLowerCase() : '';

    if (!formattedEmail) {
      return res.status(400).json({ message: 'Please provide the new email' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formattedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }

    const result = await profileService.requestEmailChangeOtp(req.user.id, formattedEmail);

    return res.status(200).json({
      message: 'Verification OTP sent to your new email',
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Something went wrong',
    });
  }
};

// 5. Verify Email Change OTP
const verifyChangeEmailOtp = async (req, res) => {
  try {
    const otpValue = String(req.body.otp ?? '').trim();
    if (!/^\d{6}$/.test(otpValue)) {
      return res.status(400).json({ message: 'Enter a valid 6-digit code' });
    }

    const updatedUser = await profileService.verifyAndChangeEmail(req.user.id, otpValue);

    return res.status(200).json({
      message: 'Email updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email is already in use by another account' });
    }
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Error updating email',
    });
  }
};

// 6. Change Password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Please fill all the fields' });
    }

    const passwordRegex = /^.{6,15}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        message: 'Password must be between 6 and 15 characters',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: 'New password and confirm password do not match',
      });
    }

    await profileService.changePassword(req.user.id, currentPassword, newPassword);

    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Error please send again',
    });
  }
};

module.exports = {
  getProfile,
  updateProfileImage,
  changeEmail,
  verifyChangeEmailOtp,
  updateProfile,
  changePassword,
};