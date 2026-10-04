const express = require("express");
const router = express.Router();
const createProduct = require('../../controllers/admin/productController');

router.post('/', createProduct);


module.exports = router;