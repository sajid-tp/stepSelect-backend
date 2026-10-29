const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  initiate,
  verifyRazorpay,
  reportFailure,
  retry,
  abandon,
  getStatus,
  razorpayWebhook,
} = require('../../controllers/user/paymentController');

const router = express.Router();

// Called by Razorpay itself (no login cookie, checked by its signature instead)
router.post('/webhook/razorpay', razorpayWebhook);

router.post('/initiate', protect('user'), initiate);
router.post('/razorpay/verify', protect('user'), verifyRazorpay);

router.get('/:orderNumber/status', protect('user'), getStatus);
router.post('/:orderNumber/failed', protect('user'), reportFailure);
router.post('/:orderNumber/retry', protect('user'), retry);
router.post('/:orderNumber/abandon', protect('user'), abandon);

module.exports = router;
