// src/services/user/orderService.js
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  RETURNABLE_ORDER_STATUSES,
  RETURN_WINDOW_DAYS,
  MAX_REASON_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  toPublicStatus,
  toStoredStatus,
} = require('../../constants/orderConstants');
const {
  isObjectId,
  escapeRegex,
  calculateTotals,
  restoreStock,
  estimatedDeliveryDate,
  addDays,
  syncReturnStatus,
} = require('../../utils/orderHelpers');
const { toOrderView, toOrderListView } = require('../../utils/orderViews');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// ---------- Internal helpers ----------

// Order by its _id or by its readable orderNumber, only if it belongs to this user
const findUserOrder = async (userId, orderRef) => {
  if (!orderRef) {
    throw createError(MESSAGES.ORDER.INVALID_ORDER_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_ID);
  }
  const filter = isObjectId(orderRef) ? { _id: orderRef, userId } : { orderNumber: String(orderRef), userId };
  const order = await Order.findOne(filter);
  if (!order) {
    throw createError(MESSAGES.ORDER.ORDER_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_NOT_FOUND);
  }
  return order;
};

const validItemId = (itemId) => {
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }
};

// Cancel reason is required and can be free text ("selected / entered by the user").
// The body field is `cancelReason`; the older name `reason` still works.
const cleanCancelReason = (body = {}) => {
  const raw = body.cancelReason !== undefined ? body.cancelReason : body.reason;
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!value) {
    throw createError(MESSAGES.ORDER.CANCEL_REASON_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_REASON_REQUIRED);
  }
  if (value.length > MAX_REASON_LENGTH) {
    throw createError(MESSAGES.ORDER.CANCEL_REASON_TOO_LONG_FOR(MAX_REASON_LENGTH), STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return value;
};

// Return reason is required free text. Body fields: `returnReason`, `returnDescription`
// (older names `reason` / `description` still work).
const cleanReturnInput = (body = {}) => {
  const rawReason = body.returnReason !== undefined ? body.returnReason : body.reason;
  const reason = rawReason === undefined || rawReason === null ? '' : String(rawReason).trim();
  if (!reason) {
    throw createError(MESSAGES.ORDER.RETURN_REASON_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_REASON_REQUIRED);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw createError(MESSAGES.ORDER.CANCEL_REASON_TOO_LONG_FOR(MAX_REASON_LENGTH), STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const rawNote = body.returnDescription !== undefined ? body.returnDescription : body.description;
  const description = rawNote ? String(rawNote).trim().slice(0, MAX_DESCRIPTION_LENGTH) || null : null;
  return { reason, description };
};

// After an item is cancelled: recalculate what the customer pays, or mark the whole order cancelled
const refreshOrderAfterCancel = async (order, reason) => {
  const items = await OrderItem.find({ orderId: order._id });
  const active = items.filter((i) => i.status !== ITEM_STATUS.CANCELLED);

  if (active.length === 0) {
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = reason || order.cancelReason;
    await order.save();
    return;
  }

  const lines = active.map((i) => ({
    lineSubtotal: i.price * i.quantity,
    lineDiscount: i.price * i.quantity - i.itemTotal,
    taxAmount: i.taxAmount,
  }));
  const totals = calculateTotals(lines, order.shippingFee);
  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.taxTotal = totals.taxTotal;
  order.totalAmount = totals.totalAmount;
  await order.save();
};

// Cancel ONE item. The status check is part of the update itself,
// so a double click can never give the stock back twice.
const cancelOneItem = async (item, reason) => {
  const cancelled = await OrderItem.findOneAndUpdate(
    { _id: item._id, status: ITEM_STATUS.PENDING },
    {
      $set: {
        status: ITEM_STATUS.CANCELLED,
        cancelledQuantity: item.quantity,
        cancelReason: reason,
        cancelledAt: new Date(),
      },
      $push: { statusHistory: { status: ITEM_STATUS.CANCELLED, note: reason || 'Cancelled by customer', updatedAt: new Date() } },
    },
    { new: true }
  );
  if (!cancelled) return false;

  await restoreStock(item.variantId, item.size, item.quantity);
  return true;
};

// The day the order was delivered. Used for the return window.
const deliveredDate = (order, items) => {
  if (order.deliveredAt) return new Date(order.deliveredAt);
  const times = items
    .flatMap((i) => i.statusHistory || [])
    .filter((h) => h.status === ITEM_STATUS.DELIVERED && h.updatedAt)
    .map((h) => new Date(h.updatedAt).getTime());
  return times.length ? new Date(Math.max(...times)) : new Date(order.updatedAt || order.createdAt);
};

// COD is paid at the door, so nothing has been collected and there is nothing to refund when an order / item is cancelled.
const NO_REFUND = Object.freeze({ refundAmount: 0, refundedTo: null });

// ---------- Public functions ----------

// 1. My orders (newest first) with search + status filter + pagination
//    status: placed | shipped | out_for_delivery | delivered | cancelled | return_requested | returned
const getMyOrders = async (userId, { search, status, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = { userId };
  const storedStatus = status ? toStoredStatus(status) : null;
  if (storedStatus && Object.values(ORDER_STATUS).includes(storedStatus)) filter.status = storedStatus;

  // Search by order number OR by the name of any product in the order
  const text = search ? String(search).trim() : '';
  if (text) {
    const regex = new RegExp(escapeRegex(text), 'i');
    const matchingItems = await OrderItem.find({ name: regex }).select('orderId');
    filter.$or = [{ orderNumber: regex }, { _id: { $in: matchingItems.map((i) => i.orderId) } }];
  }

  const totalResults = await Order.countDocuments(filter);
  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const items = await OrderItem.find({ orderId: { $in: orders.map((o) => o._id) } });

  return {
    orders: orders.map((o) =>
      toOrderListView(o, items.filter((i) => String(i.orderId) === String(o._id)), 'user')
    ),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalResults,
      totalPages: Math.ceil(totalResults / limitNum),
    },
  };
};

// 2. One order
const getMyOrder = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  const items = await OrderItem.find({ orderId: order._id });
  return toOrderView(order, items, 'user');
};

// 2b. Order success screen: just enough to say "Order confirmed"
const getOrderSummary = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  const itemCount = await OrderItem.countDocuments({ orderId: order._id });
  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    estimatedDelivery: estimatedDeliveryDate(order),
    itemCount,
    status: toPublicStatus(order.status, 'user'),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
};

// 3. Cancel the whole order (only before it is shipped)
//    -> { orderId, status, refundAmount, refundedTo, order }
const cancelOrder = async (userId, orderRef, body = {}) => {
  const reason = cleanCancelReason(body);
  const order = await findUserOrder(userId, orderRef);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.ORDER_ALREADY_CANCELLED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (order.status === ORDER_STATUS.DELIVERED) {
    throw createError(MESSAGES.ORDER.ORDER_ALREADY_DELIVERED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (order.status !== ORDER_STATUS.PENDING) {
    throw createError(MESSAGES.ORDER.CANNOT_CANCEL_AFTER_SHIPPED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  const items = await OrderItem.find({ orderId: order._id, status: ITEM_STATUS.PENDING });
  if (items.length === 0) {
    throw createError(MESSAGES.ORDER.ALL_ITEMS_ALREADY_CANCELLED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  for (const item of items) await cancelOneItem(item, reason);
  await refreshOrderAfterCancel(order, reason);

  const view = await getMyOrder(userId, order._id);
  return { orderId: view.id, status: view.status, ...NO_REFUND, order: view };
};

// 4. Cancel one product of the order
//    -> { orderItemId, status, refundAmount, refundedTo, order }
const cancelOrderItem = async (userId, orderRef, itemId, body = {}) => {
  validItemId(itemId);
  const reason = cleanCancelReason(body);
  const order = await findUserOrder(userId, orderRef);

  const item = await OrderItem.findOne({ _id: itemId, orderId: order._id });
  if (!item) {
    throw createError(MESSAGES.ORDER.ITEM_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_ITEM_NOT_FOUND);
  }
  if (item.status === ITEM_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.ITEM_ALREADY_CANCELLED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (item.status !== ITEM_STATUS.PENDING) {
    throw createError(MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  const done = await cancelOneItem(item, reason);
  if (!done) {
    // someone cancelled / shipped it between our check and the update
    throw createError(MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED, STATUS.BAD_REQUEST, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  await refreshOrderAfterCancel(order, reason);

  const view = await getMyOrder(userId, order._id);
  const itemView = view.items.find((i) => i.orderItemId === String(item._id));
  return { orderItemId: String(item._id), status: itemView.status, ...NO_REFUND, order: view };
};

// 5. Return a delivered order, or only some of its items (7-day window). Reason is mandatory.
//    itemIds = only these items. Without it every delivered item of the order is returned.
//    single  = the request came from the single-item route (only changes the error wording).
const requestReturn = async (userId, orderRef, body = {}, { itemIds = null, single = false } = {}) => {
  const { reason, description } = cleanReturnInput(body);

  const order = await findUserOrder(userId, orderRef);
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
    throw createError(MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  const filter = { orderId: order._id, status: ITEM_STATUS.DELIVERED };
  if (Array.isArray(itemIds) && itemIds.length > 0) {
    if (!itemIds.every(isObjectId)) {
      throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
    }
    filter._id = { $in: itemIds };
  }

  // Return window: RETURN_WINDOW_DAYS after delivery
  const allItems = await OrderItem.find({ orderId: order._id });
  if (new Date() > addDays(deliveredDate(order, allItems), RETURN_WINDOW_DAYS)) {
    throw createError(
      single ? MESSAGES.ORDER.RETURN_ITEM_WINDOW_EXPIRED : MESSAGES.ORDER.RETURN_WINDOW_EXPIRED(RETURN_WINDOW_DAYS),
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_WINDOW_EXPIRED
    );
  }

  const result = await OrderItem.updateMany(filter, {
    $set: {
      status: ITEM_STATUS.RETURN_REQUESTED,
      returnReason: reason,
      returnDescription: description,
      returnRequestedAt: new Date(),
    },
    $push: { statusHistory: { status: ITEM_STATUS.RETURN_REQUESTED, note: reason, updatedAt: new Date() } },
  });

  if (result.modifiedCount === 0) {
    throw createError(MESSAGES.ORDER.NO_RETURNABLE_ITEMS, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  await syncReturnStatus(order);
  return getMyOrder(userId, order._id);
};

// POST /orders/:orderId/return  -> { orderId, status: 'return_requested', order }
const returnOrder = async (userId, orderRef, body = {}) => {
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds : null;
  const view = await requestReturn(userId, orderRef, body, { itemIds });
  return { orderId: view.id, status: ITEM_STATUS.RETURN_REQUESTED, order: view };
};

// POST /orders/:orderId/items/:orderItemId/return  -> { orderItemId, status: 'return_requested', order }
const returnOrderItem = async (userId, orderRef, itemId, body = {}) => {
  validItemId(itemId);
  const order = await findUserOrder(userId, orderRef);
  const item = await OrderItem.findOne({ _id: itemId, orderId: order._id });
  if (!item) {
    throw createError(MESSAGES.ORDER.ITEM_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_ITEM_NOT_FOUND);
  }

  const view = await requestReturn(userId, orderRef, body, { itemIds: [String(item._id)], single: true });
  return { orderItemId: String(item._id), status: ITEM_STATUS.RETURN_REQUESTED, order: view };
};

// 6. Everything the invoice PDF needs (order must belong to the user and not be cancelled)
const getInvoiceData = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER, STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST);
  }
  const items = await OrderItem.find({ orderId: order._id, status: { $ne: ITEM_STATUS.CANCELLED } });
  return { order, items };
};

module.exports = {
  getMyOrders,
  getMyOrder,
  getOrderSummary,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  returnOrderItem,
  getInvoiceData,
  // shared with the admin service
  toOrderView,
  refreshOrderAfterCancel,
  cancelOneItem,
};
