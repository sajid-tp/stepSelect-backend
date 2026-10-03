const express = require("express");

const router = express.Router();

const {getProfile, updateProfileImage, changeEmail, verifyChangeEmailOtp, updateProfile, changePassword} = require('../../controllers/user/profileController')
const {protect} = require('../../middleware/authMiddleware');
const {upload}= require('../../middleware/uploadMiddleware')

router.get('/profile',protect,getProfile);
router.patch('/profile',protect, updateProfile);
router.post('/profile-image',protect, upload.single('profileImage'),updateProfileImage);
router.post('/change-email',protect, changeEmail);
router.post('/verify-change-email-otp',protect, verifyChangeEmailOtp);
router.patch('/password',protect,changePassword);

module.exports = router;

