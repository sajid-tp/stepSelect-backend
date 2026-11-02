// src/controllers/admin/orderController.js
const adminOrderService = require('../../services/admin/adminOrderServices');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

/*
  GET   /api/admin/orders?search=&status=&sort=newest|oldest|amount_high|amount_low&from=&to=&page=&limit=
        status = an order status, or return_requested (the "Returns" tab: orders with a return waiting for the admin)
        each order has returnRequestCount; the response also has pendingReturnOrders (number for the tab badge)
  GET   /api/admin/orders/:orderId
  PATCH /api/admin/orders/:orderId/items/:itemId/status   body: { status }   <- delivery status of ONE product
        (the order's own status then follows its items by itself)
  PATCH /api/admin/orders/:orderId                    body: { status }   <- same step for every open item at once (Postman)
  PATCH /api/admin/orders/:orderId/status             body: { status }   (same thing, longer URL)
  PATCH /api/admin/orders/:orderId/items/:itemId/return   body: { action: 'approve' | 'reject', reason }   (reason required for reject)
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

const updateItemStatus = async (req, res) => {
  const { orderId, itemId } = req.params;
  const { status } = req.body || {};
  const data = await adminOrderService.updateItemStatus(orderId, itemId, status);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ITEM_STATUS_UPDATED, data });
};

const updateOrderStatus = async (req, res) => {
  const { status } = req.body || {};
  const data = await adminOrderService.updateOrderStatus(req.params.orderId, status);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ORDER_STATUS_UPDATED, data });
};

const handleReturn = async (req, res) => {
  const { orderId, itemId } = req.params;
  const { action, reason } = req.body || {};
  const data = await adminOrderService.handleReturn(orderId, itemId, action, reason);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.RETURN_UPDATED, data });
};

module.exports = { getOrders, getOrder, updateItemStatus, updateOrderStatus, handleReturn };
