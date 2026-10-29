const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  initiate,
<<<<<<< HEAD
  payWithWallet,
=======
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
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
<<<<<<< HEAD
router.post('/wallet/pay', protect('user'), payWithWallet);
=======
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
router.post('/razorpay/verify', protect('user'), verifyRazorpay);

router.get('/:orderNumber/status', protect('user'), getStatus);
router.post('/:orderNumber/failed', protect('user'), reportFailure);
router.post('/:orderNumber/retry', protect('user'), retry);
router.post('/:orderNumber/abandon', protect('user'), abandon);

module.exports = router;
