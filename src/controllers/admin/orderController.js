
const adminOrderService = require('../../services/admin/adminOrderServices');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');


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
  const { action, reason, restock } = req.body || {};
  const data = await adminOrderService.handleReturn(orderId, itemId, action, reason, restock);
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.RETURN_UPDATED, data });
};

module.exports = { getOrders, getOrder, updateItemStatus, updateOrderStatus, handleReturn };
