const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const {
  getOrders,
  getOrder,
  updateOrder,
  updateOrderStatus,
  handleReturn,
} = require('../../controllers/admin/orderController');

const router = express.Router();

router.get('/', protect('admin'), getOrders);
router.get('/:orderId', protect('admin'), getOrder);
router.patch('/:orderId', protect('admin'), updateOrder); // status, paymentStatus, carrier, trackingId
router.patch('/:orderId/status', protect('admin'), updateOrderStatus); // older route, status only
router.patch('/:orderId/items/:itemId/return', protect('admin'), handleReturn);

module.exports = router;
