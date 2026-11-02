// src/routes/user/couponRoutes.js  (mounted at /api/coupons in server.js)
const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getCoupons } = require('../../controllers/user/couponController');

const router = express.Router();

router.get('/', protect('user'), getCoupons);

module.exports = router;
