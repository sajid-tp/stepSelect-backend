// src/controllers/admin/orderController.js
const adminOrderService = require('../../services/admin/adminOrderServices');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

/*
  GET   /api/admin/orders?search=&status=&sort=newest|oldest|amount_high|amount_low&from=&to=&page=&limit=
  GET   /api/admin/orders/:orderId
  PATCH /api/admin/orders/:orderId                    body: { status?, paymentStatus?, carrier?, trackingId? }   <- the Postman route
  PATCH /api/admin/orders/:orderId/status             body: { status }   (older route, status only)
  PATCH /api/admin/orders/:orderId/items/:itemId/return   body: { action: 'approve' | 'reject' }
*/

const getOrders = async (req, res) => {
  const { search, status, sort, from, to, page, limit } = req.query;
  const data = await adminOrderService.getOrders({ search, status, sort, from, to, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const getOrder = async (req, res) => {
  const data = await adminOrderService.getOrder(req.params.orderId);
  return res.status(STATUS.OK).json({ data });
};

const updateOrder = async (req, res) => {
  const data = await adminOrderService.updateOrder(req.params.orderId, req.body || {});
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ORDER_STATUS_UPDATED, data });
};

const updateOrderStatus = async (req, res) => {
  const { status } = req.body || {};
  const data = await adminOrderService.updateOrderStatus(req.params.orderId, status);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ORDER_STATUS_UPDATED, data });
};

const handleReturn = async (req, res) => {
  const { orderId, itemId } = req.params;
  const { action } = req.body || {};
  const data = await adminOrderService.handleReturn(orderId, itemId, action);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.RETURN_UPDATED, data });
};

module.exports = { getOrders, getOrder, updateOrder, updateOrderStatus, handleReturn };
