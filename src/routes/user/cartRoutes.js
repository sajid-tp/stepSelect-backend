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

router.get('/', getCart);
router.post('/', addToCart);
router.patch('/items/:variantId', updateCartItem);
router.delete('/items/:variantId', removeCartItem);
router.delete('/', clearCart);

module.exports = router;
