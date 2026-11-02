const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getCheckoutSummary, placeOrder } = require('../../controllers/user/checkoutController');

const router = express.Router();

router.get('/', protect('user'), getCheckoutSummary);
router.post('/place-order', protect('user'), placeOrder);

module.exports = router;
