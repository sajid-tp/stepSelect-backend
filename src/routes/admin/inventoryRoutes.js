const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getInventory, updateStock } = require('../../controllers/admin/inventoryController');

const router = express.Router();

router.get('/', protect('admin'), getInventory);
router.patch('/:variantId/stock', protect('admin'), updateStock);

module.exports = router;
