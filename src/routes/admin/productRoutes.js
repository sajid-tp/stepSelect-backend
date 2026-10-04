const express = require("express");
const router = express.Router();
const {createProduct, updateProduct, getProducts, getProduct, deleteProduct, toggleProductStatus} = require('../../controllers/admin/productController');


router.get('/', getProducts);
router.get('/:productId',getProduct);
router.post('/', createProduct);
router.patch('/:productId', updateProduct);
router.delete('/:productId', deleteProduct);
router.patch('/:productId/status', toggleProductStatus);

module.exports = router;