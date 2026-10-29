const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { placeOrder } = require('../../controllers/user/checkoutController');
const {
  getMyOrders,
  getReasons,
  getMyOrder,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  returnOrderItem,
  downloadInvoice,
} = require('../../controllers/user/orderController');

const router = express.Router();

router.post('/cod', protect('user'), placeOrder); 
router.get('/', protect('user'), getMyOrders);
router.get('/reasons', protect('user'), getReasons); 

router.get('/:orderId', protect('user'), getMyOrder);
router.get('/:orderId/invoice', protect('user'), downloadInvoice);
router.post('/:orderId/cancel', protect('user'), cancelOrder);
router.post('/:orderId/items/:itemId/cancel', protect('user'), cancelOrderItem);
router.post('/:orderId/return', protect('user'), returnOrder);
router.post('/:orderId/items/:itemId/return', protect('user'), returnOrderItem);

module.exports = router;
