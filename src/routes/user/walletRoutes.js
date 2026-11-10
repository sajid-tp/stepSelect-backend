const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getWallet, initiateTopUp, verifyTopUp } = require('../../controllers/user/walletController');

const router = express.Router();

router.get('/', protect('user'), getWallet);

router.post('/top-up/initiate', protect('user'), initiateTopUp);
router.post('/top-up/verify', protect('user'), verifyTopUp);

module.exports = router;
