const express = require("express");
const router = express.Router();
const {createProduct, updateProduct, getProducts, getProduct, deleteProduct, toggleProductStatus} = require('../../controllers/admin/productController');
const {protect} = require('../../middleware/authMiddleware');


router.get('/',protect("admin"), getProducts);
router.get('/:productId',protect("admin"),getProduct);
router.post('/', protect("admin"), createProduct);
router.patch('/:productId',protect("admin"), updateProduct);
router.delete('/:productId',protect("admin"), deleteProduct);
router.patch('/:productId/status',protect("admin"), toggleProductStatus);

module.exports = router;