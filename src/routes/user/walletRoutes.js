const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getWallet, addMoney } = require('../../controllers/user/walletController');

const router = express.Router();

router.get('/', protect('user'), getWallet);
router.post('/add-money', protect('user'), addMoney);

module.exports = router;
