// src/controllers/user/orderController.js
const orderService = require('../../services/user/orderService');
const { writeInvoice } = require('../../services/user/invoiceService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { CANCEL_REASONS, RETURN_REASONS } = require('../../constants/orderConstants');

/*
  GET    /api/orders?search=&status=&page=&limit=   -> data = { orders[], pagination }
  GET    /api/orders/reasons                        -> data = { cancelReasons[], returnReasons[] }
  GET    /api/orders/:orderId                       -> data = order        (orderId = _id or orderNumber)
  POST   /api/orders/:orderId/cancel                body: { reason? }
  POST   /api/orders/:orderId/items/:itemId/cancel  body: { reason? }
  POST   /api/orders/:orderId/return                body: { reason (required), description?, itemIds? }
  GET    /api/orders/:orderId/invoice               -> PDF file download
*/

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const getMyOrders = async (req, res) => {
  const { search, status, page, limit } = req.query;
  const data = await orderService.getMyOrders(getUserId(req), { search, status, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const getReasons = async (req, res) =>
  res.status(STATUS.OK).json({ data: { cancelReasons: CANCEL_REASONS, returnReasons: RETURN_REASONS } });

const getMyOrder = async (req, res) => {
  const data = await orderService.getMyOrder(getUserId(req), req.params.orderId);
  return res.status(STATUS.OK).json({ data });
};

const cancelOrder = async (req, res) => {
  const body = req.body || {};
  const data = await orderService.cancelOrder(getUserId(req), req.params.orderId, {
    reason: body.reason ?? body.cancelReason,
  });
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ORDER_CANCELLED_SUCCESSFULLY, data });
};

const cancelOrderItem = async (req, res) => {
  const { orderId, itemId } = req.params;
  const body = req.body || {};
  const data = await orderService.cancelOrderItem(getUserId(req), orderId, itemId, {
    reason: body.reason ?? body.cancelReason,
  });
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.ITEM_CANCELLED_SUCCESSFULLY, data });
};

const returnOrder = async (req, res) => {
  const body = req.body || {};
  const data = await orderService.returnOrder(getUserId(req), req.params.orderId, {
    reason: body.reason ?? body.returnReason,
    description: body.description ?? body.returnDescription,
    itemIds: body.itemIds,
  });
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.RETURN_REQUESTED_SUCCESSFULLY, data });
};

const getOrderSummary = async (req, res) => {
  const order = await orderService.getMyOrder(getUserId(req), req.params.orderId);
  return res.status(STATUS.OK).json({
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalAmount: order.pricing.totalAmount,
      createdAt: order.createdAt,
    },
  });
};

const returnOrderItem = async (req, res) => {
  const body = req.body || {};
  const data = await orderService.returnOrder(getUserId(req), req.params.orderId, {
    reason: body.reason ?? body.returnReason,
    description: body.description ?? body.returnDescription,
    itemIds: [req.params.itemId],
  });
  return res.status(STATUS.OK).json({ message: MESSAGES.ORDER.RETURN_REQUESTED_SUCCESSFULLY, data });
};

const downloadInvoice = async (req, res) => {
  const invoice = await orderService.getInvoiceData(getUserId(req), req.params.orderId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.order.orderNumber}.pdf"`);
  writeInvoice(res, invoice);
};

module.exports = {
  getMyOrders,
  getReasons,
  getMyOrder,
  getOrderSummary,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  returnOrderItem,
  downloadInvoice,
};
