const express = require('express');

const router = express.Router();

const {
  getProducts,
  getProduct,
} = require('../../controllers/user/productController');


// GET /api/products
router.get('/', getProducts);

// GET /api/products/:productId
router.get('/:productId', getProduct);


module.exports = router;