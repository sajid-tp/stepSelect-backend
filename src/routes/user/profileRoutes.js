const express = require("express");
const router = express.Router();
const {getProfile, updateProfileImage, changeEmail, verifyChangeEmailOtp, updateProfile, changePassword} = require('../../controllers/user/profileController')
const {protect} = require('../../middleware/authMiddleware');
const {upload}= require('../../middleware/uploadMiddleware')

router.get('/profile',protect("user"),getProfile);
router.patch('/profile',protect("user"), updateProfile);
router.post('/profile-image',protect("user"), upload.single('profileImage'),updateProfileImage);
router.post('/change-email',protect("user"), changeEmail);
router.post('/verify-change-email-otp',protect("user"), verifyChangeEmailOtp);
router.patch('/password',protect("user"),changePassword);

module.exports = router;

