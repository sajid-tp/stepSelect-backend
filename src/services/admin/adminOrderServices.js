// src/services/admin/adminOrderServices.js
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const User = require('../../models/user');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  STATUS_FLOW,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');
const { isObjectId, escapeRegex, restoreStock, calculateTotals, pushHistory } = require('../../utils/orderHelpers');
const { toOrderView } = require('../user/orderService');
const { refundOrder } = require('../payment/refundService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  amount_high: { totalAmount: -1, createdAt: -1 },
  amount_low: { totalAmount: 1, createdAt: -1 },
};

const findOrder = async (orderRef) => {
  if (!orderRef) {
    throw createError(MESSAGES.ORDER.INVALID_ORDER_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_ID);
  }
  const order = await Order.findOne(isObjectId(orderRef) ? { _id: orderRef } : { orderNumber: String(orderRef) });
  if (!order) {
    throw createError(MESSAGES.ORDER.ORDER_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_NOT_FOUND);
  }
  return order;
};

const toUserView = (user) =>
  user
    ? { id: String(user._id), username: user.username, email: user.email, phoneNumber: user.phoneNumber || '' }
    : null;

// 1. Orders list: newest first by default, with search / status filter / sort / date range / pagination
const getOrders = async ({ search, status, sort, from, to, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  // Online orders that were never paid are not real orders yet
  const filter = { $nor: [unpaidOnlineFilter()] };

  if (status && Object.values(ORDER_STATUS).includes(status)) filter.status = status;

  // Date range on the order date (from / to as YYYY-MM-DD)
  if (from || to) {
    filter.createdAt = {};
    if (from && !isNaN(new Date(from))) filter.createdAt.$gte = new Date(from);
    if (to && !isNaN(new Date(to))) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
    if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
  }

  // Search by order number, customer name or customer email
  const text = search ? String(search).trim() : '';
  if (text) {
    const regex = new RegExp(escapeRegex(text), 'i');
    const users = await User.find({ $or: [{ username: regex }, { email: regex }] }).select('_id');
    filter.$or = [{ orderNumber: regex }, { userId: { $in: users.map((u) => u._id) } }];
  }

  const sortBy = SORTS[sort] || SORTS.newest;

  const totalItems = await Order.countDocuments(filter);
  const orders = await Order.find(filter)
    .sort(sortBy)
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .populate('userId', 'username email phoneNumber');

  const counts = await OrderItem.aggregate([
    { $match: { orderId: { $in: orders.map((o) => o._id) } } },
    { $group: { _id: '$orderId', count: { $sum: 1 } } },
  ]);

  return {
    orders: orders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      totalAmount: o.totalAmount,
      itemCount: (counts.find((c) => String(c._id) === String(o._id)) || {}).count || 0,
      user: toUserView(o.userId),
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

// 2. One order with customer details
const getOrder = async (orderRef) => {
  const order = await findOrder(orderRef);
  const [items, user] = await Promise.all([
    OrderItem.find({ orderId: order._id }),
    User.findById(order.userId).select('username email phoneNumber'),
  ]);

  const nextIndex = STATUS_FLOW.indexOf(order.status) + 1;
  const canChange = ![ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status);

  return {
    ...toOrderView(order, items),
    user: toUserView(user),
    // Statuses the admin dropdown can offer right now
    allowedStatuses: canChange
      ? [...STATUS_FLOW.slice(nextIndex), ORDER_STATUS.CANCELLED]
      : [],
  };
};

// Internal Helper: cancel every item that has not been delivered yet, give the stock back
const cancelAllOpenItems = async (order, note) => {
  const items = await OrderItem.find({
    orderId: order._id,
    status: { $in: [ITEM_STATUS.PENDING, ITEM_STATUS.SHIPPED, ITEM_STATUS.OUT_FOR_DELIVERY] },
  });

  for (const item of items) {
    const done = await OrderItem.findOneAndUpdate(
      { _id: item._id, status: item.status },
      {
        $set: {
          status: ITEM_STATUS.CANCELLED,
          cancelledQuantity: item.quantity,
          cancelReason: note,
          cancelledAt: new Date(),
        },
        $push: { statusHistory: { status: ITEM_STATUS.CANCELLED, note, updatedAt: new Date() } },
      }
    );
    if (done) await restoreStock(item.variantId, item.size, item.quantity);
  }
};

// 3. Change order status. Forward only: pending -> shipped -> out_for_delivery -> delivered. Cancel before delivery.
const updateOrderStatus = async (orderRef, newStatus) => {
  if (!Object.values(ORDER_STATUS).includes(newStatus)) {
    throw createError(MESSAGES.ORDER.INVALID_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_STATUS);
  }

  const order = await findOrder(orderRef);
  const current = order.status;

  if (current === ORDER_STATUS.CANCELLED || current === ORDER_STATUS.DELIVERED || newStatus === current) {
    throw createError(
      MESSAGES.ORDER.INVALID_STATUS_TRANSITION(current, newStatus),
      STATUS.CONFLICT,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  if (newStatus === ORDER_STATUS.CANCELLED) {
    await cancelAllOpenItems(order, 'Cancelled by admin');
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = 'Cancelled by admin';
    await order.save();
    await refundOrder(order, null, { reason: 'cancel' }); // paid (Razorpay / wallet): money goes to the wallet at once (COD / unpaid: does nothing)
    return getOrder(order._id);
  }

  // An online order can only move forward once its payment has arrived
  if (order.paymentMethod !== PAYMENT_METHODS.COD && order.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw createError('Payment has not been received for this order yet.', STATUS.CONFLICT, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }

  if (STATUS_FLOW.indexOf(newStatus) <= STATUS_FLOW.indexOf(current)) {
    throw createError(
      MESSAGES.ORDER.INVALID_STATUS_TRANSITION(current, newStatus),
      STATUS.CONFLICT,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  // Move every item that is still in the normal flow (cancelled / return items are left alone)
  const items = await OrderItem.find({ orderId: order._id, status: { $in: STATUS_FLOW } });
  for (const item of items) {
    item.status = newStatus;
    item.statusHistory.push({ status: newStatus, note: 'Updated by admin', updatedAt: new Date() });
    if (newStatus === ORDER_STATUS.DELIVERED) item.deliveredQuantity = item.quantity;
    await item.save();
  }

  order.status = newStatus;
  if (newStatus === ORDER_STATUS.DELIVERED) {
    order.deliveredAt = new Date();
    if (order.paymentMethod === PAYMENT_METHODS.COD) order.paymentStatus = PAYMENT_STATUS.PAID; // cash collected on delivery
  }
  await order.save();

  return getOrder(order._id);
};

// 4. Approve or reject a return request for one item
const handleReturn = async (orderRef, itemId, action, reason) => {
  if (!['approve', 'reject'].includes(action)) {
    throw createError(MESSAGES.ORDER.INVALID_RETURN_ACTION, STATUS.BAD_REQUEST);
  }
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }

  // A rejection must come with a reason, so the customer knows why
  const cleanReason = String(reason || '').trim().slice(0, 300);
  if (action === 'reject' && !cleanReason) {
    throw createError('Please give a reason for rejecting the return.', STATUS.BAD_REQUEST);
  }

  const order = await findOrder(orderRef);

  const item = await OrderItem.findOne({
    _id: itemId,
    orderId: order._id,
    status: ITEM_STATUS.RETURN_REQUESTED,
  });
  if (!item) {
    throw createError(MESSAGES.ORDER.NO_RETURN_REQUEST_FOR_ITEM, STATUS.CONFLICT, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  // Units the customer asked for (older requests saved before the schema fix fall back to the whole line)
  const requestedQty = item.returnRequestedQuantity || item.quantity - (item.cancelledQuantity || 0);

  if (action === 'approve') {
    item.returnedQuantity = (item.returnedQuantity || 0) + requestedQty;
    item.returnRequestedQuantity = 0;

    // Everything returned -> "returned". Only some units returned -> back to "delivered"
    // so the customer can still return the rest later.
    const delivered = item.deliveredQuantity || item.quantity - (item.cancelledQuantity || 0);
    item.status = item.returnedQuantity >= delivered ? ITEM_STATUS.RETURNED : ITEM_STATUS.DELIVERED;

    pushHistory(item, ITEM_STATUS.RETURNED, `Return approved for ${requestedQty} unit(s)`);
    await item.save();
    await restoreStock(item.variantId, item.size, requestedQty); // shoes go back on the shelf

    // The admin approved the return: put what these units cost (after their share of the coupon,
    // plus tax) into the customer's wallet. This also covers Cash on Delivery orders.
    if (item.quantity > 0) {
      const perUnit = (item.itemTotal - (item.couponShare || 0) + (item.taxAmount || 0)) / item.quantity;
      await refundOrder(order, Math.round(perUnit * requestedQty * 100) / 100, {
        reason: 'return',
        note: `${item.name} x${requestedQty}`,
      });
    }
  } else {
    // Rejected: keep the reason and put the item back to "delivered"
    item.returnRejectReason = cleanReason;
    item.returnRejectedAt = new Date();
    item.returnRequestedQuantity = 0;
    item.status = ITEM_STATUS.DELIVERED;

    pushHistory(item, ITEM_STATUS.RETURN_REJECTED, `Return rejected: ${cleanReason}`);
    await item.save();
  }

  return getOrder(order._id);
};

module.exports = { getOrders, getOrder, updateOrderStatus, handleReturn };
