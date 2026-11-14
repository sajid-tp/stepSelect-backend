const express = require("express");
const router = express.Router();
const {getProfile, updateProfileImage, removeProfileImage, changeEmail, verifyChangeEmailOtp, updateProfile, changePassword} = require('../../controllers/user/profileController')
const {protect} = require('../../middleware/authMiddleware');
const {uploadProfileImage}= require('../../middleware/uploadMiddleware')
const {otpVerifyLimiter, otpSendLimiter} = require('../../middleware/rateLimiter');

router.get('/profile',protect("user"),getProfile);
router.patch('/profile',protect("user"), updateProfile);
router.post('/profile-image',protect("user"), uploadProfileImage, updateProfileImage);
router.delete('/profile-image',protect("user"), removeProfileImage);
router.post('/change-email',protect("user"), otpSendLimiter, changeEmail);
router.post('/verify-change-email-otp',protect("user"), otpVerifyLimiter, verifyChangeEmailOtp);
router.patch('/password',protect("user"),changePassword);

module.exports = router;
