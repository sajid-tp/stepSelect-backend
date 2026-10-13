const express = require('express');
const router = express.Router();
const { searchLimiter } = require("../../middleware/rateLimiter");
const {getProducts, getProduct, getRelatedProducts} = require('../../controllers/user/productController');

router.get('/', searchLimiter, getProducts);

router.get('/:productId', getProduct);

router.get('/:productId/related', getRelatedProducts);

module.exports = router;