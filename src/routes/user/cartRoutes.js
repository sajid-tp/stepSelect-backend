const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require('../../controllers/user/cartController');



const router = express.Router();


router.get('/',protect("user"), getCart);
router.post('/', protect("user"), addToCart);
router.patch('/items/:variantId', protect("user"), updateCartItem);
router.delete('/items/:variantId', protect("user"), removeCartItem);
router.delete('/',protect("user"), clearCart);

module.exports = router;
