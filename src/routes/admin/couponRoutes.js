const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getCoupons,
  createCoupon,
  getCouponById,
  updateCoupon,
  setCouponStatus,
  deleteCoupon,
} = require('../../controllers/admin/couponController');

router.use(protect('admin'));
router.get('/', getCoupons);
router.post('/', createCoupon);
router.get('/:couponId', getCouponById);
router.patch('/:couponId', updateCoupon);
router.patch('/:couponId/status', setCouponStatus);
router.delete('/:couponId', deleteCoupon);

module.exports = router;
