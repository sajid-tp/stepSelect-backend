const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  getWishlist,
  getWishlistIds,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
} = require('../../controllers/user/wishlistController');

const router = express.Router();

router.get('/', protect('user'), getWishlist);
router.get('/ids', protect('user'), getWishlistIds);
router.post('/', protect('user'), addToWishlist);
router.delete('/items/:variantId', protect('user'), removeFromWishlist);
router.delete('/', protect('user'), clearWishlist);

module.exports = router;
