const express = require("express");
const router = express.Router();
const {createProduct, updateProduct} = require('../../controllers/admin/productController');

router.post('/', createProduct);
router.patch('/:productId', updateProduct);


module.exports = router;