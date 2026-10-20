const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getOrders, getOrder, updateOrderStatus, handleReturn } = require('../../controllers/admin/orderController');

const router = express.Router();

router.get('/', protect('admin'), getOrders);
router.get('/:orderId', protect('admin'), getOrder);
// Keep the explicit route and support the current Postman collection's shorter URL.
router.patch('/:orderId/status', protect('admin'), updateOrderStatus);
router.patch('/:orderId', protect('admin'), updateOrderStatus);
router.patch('/:orderId/items/:itemId/return', protect('admin'), handleReturn);

module.exports = router;
