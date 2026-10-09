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

// Every cart route needs a logged-in user (one line, so none can be forgotten).
router.use(protect);

router.get('/', protect, getCart);
router.post('/', protect, addToCart);
router.patch('/items/:variantId', protect, updateCartItem);
router.delete('/items/:variantId', protect, removeCartItem);
router.delete('/', protect, clearCart);

module.exports = router;
