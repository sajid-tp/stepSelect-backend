const express = require('express');

const router = express.Router();

const {
  getProducts,
  getProduct,
  getRelatedProducts
} = require('../../controllers/user/productController');
const {protect} = require('../../middleware/authMiddleware');

// GET /api/products
router.get('/', getProducts);

// GET /api/products/:productId
router.get('/:productId', getProduct);

router.get('/:productId/related', getRelatedProducts);


module.exports = router;