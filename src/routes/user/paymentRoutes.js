const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  initiate,
  payWithWallet,
  verifyRazorpay,
  reportFailure,
  retry,
  abandon,
  getStatus,
  razorpayWebhook,
} = require('../../controllers/user/paymentController');

const router = express.Router();

router.post('/webhook/razorpay', razorpayWebhook);

router.post('/initiate', protect('user'), initiate);
router.post('/wallet/pay', protect('user'), payWithWallet);
router.post('/razorpay/verify', protect('user'), verifyRazorpay);

router.get('/:orderNumber/status', protect('user'), getStatus);
router.post('/:orderNumber/failed', protect('user'), reportFailure);
router.post('/:orderNumber/retry', protect('user'), retry);
router.post('/:orderNumber/abandon', protect('user'), abandon);

module.exports = router;
