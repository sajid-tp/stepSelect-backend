const express = require('express');
const router = express.Router();
const {  login, signup, sendOtp, verifyOtp, forgotPassword, verifyResetOtp, resetPassword, resendOtp,google,logout,refreshToken}= require('../../controllers/user/authController');

router.post("/signup",signup);
router.post("/login",login);
router.post("/send-otp",sendOtp);
router.post("/verify-otp",verifyOtp);
router.post("/forgot-password",forgotPassword);
router.post("/verify-reset-otp",verifyResetOtp);
router.post("/resend-otp",resendOtp);
router.post("/reset-password",resetPassword);
router.post("/google",google);
router.post("/refresh",refreshToken);
router.post("/logout", logout);

module.exports = router;