const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require('../../controllers/user/cartController');
const { applyCoupon, removeCoupon } = require('../../controllers/user/couponController');



const router = express.Router();


router.get('/',protect("user"), getCart);
router.post('/', protect("user"), addToCart);
router.patch('/items/:variantId', protect("user"), updateCartItem);
router.delete('/items/:variantId', protect("user"), removeCartItem);
router.delete('/',protect("user"), clearCart);

// Coupons applied to the cart (list of coupons is GET /api/coupons)
router.post('/apply-coupon', protect("user"), applyCoupon);
router.delete('/coupon', protect("user"), removeCoupon);

module.exports = router;
