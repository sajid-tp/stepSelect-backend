const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { searchLimiter } = require('../../middleware/rateLimiter');
const { validate, getProgram, getMyReferral, getEligibility } = require('../../controllers/user/referralController');

router.get('/validate', searchLimiter, validate);
router.get('/program', getProgram);
router.get('/me', protect('user'), getMyReferral);
router.get('/eligibility', protect('user'), getEligibility);

module.exports = router;
