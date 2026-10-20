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
  CANCEL_REASONS,
  RETURN_REASONS,
} = require('../../constants/orderConstants');
const {
  isObjectId,
  escapeRegex,
  calculateTotals,
  restoreStock,
} = require('../../utils/orderHelpers');
const { releaseCoupon } = require('./couponService');

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

// Optional reason for cancelling: must be one of the list if given
const cleanCancelReason = (reason) => {
  if (reason === undefined || reason === null || String(reason).trim() === '') return null;
  const value = String(reason).trim();
  if (!CANCEL_REASONS.includes(value)) {
    throw createError(MESSAGES.ORDER.INVALID_CANCEL_REASON, STATUS.BAD_REQUEST);
  }
  return value;
};

const toItemView = (item) => ({
  id: String(item._id),
  productId: String(item.productId),
  variantId: String(item.variantId),
  name: item.name,
  color: item.color,
  size: item.size,
  image: item.image,
  price: item.price,
  discountPercent: item.discountPercent,
  finalPrice: item.finalPrice,
  quantity: item.quantity,
  itemTotal: item.itemTotal,
  status: item.status,
  cancelReason: item.cancelReason,
  cancelledAt: item.cancelledAt,
  returnReason: item.returnReason,
  returnDescription: item.returnDescription,
  returnRequestedAt: item.returnRequestedAt,
  statusHistory: item.statusHistory,
  canCancel: item.status === ITEM_STATUS.PENDING,
  canReturn: item.status === ITEM_STATUS.DELIVERED,
});

const toOrderView = (order, items) => {
  const itemViews = items.map(toItemView);
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    shippingAddress: order.shippingAddress,
    couponCode: order.couponCode || null,
    pricing: {
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      couponDiscount: order.couponDiscount || 0,
      taxTotal: order.taxTotal,
      shippingFee: order.shippingFee,
      totalAmount: order.totalAmount,
    },
    items: itemViews,
    itemCount: itemViews.length,
    canCancel: order.status === ORDER_STATUS.PENDING && itemViews.some((i) => i.canCancel),
    canReturn: order.status === ORDER_STATUS.DELIVERED && itemViews.some((i) => i.canReturn),
    canDownloadInvoice: order.status !== ORDER_STATUS.CANCELLED,
  };
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
    // The whole order is gone, so the coupon use goes back to the user and the coupon
    await releaseCoupon(order.couponId);
    return;
  }

  const lines = active.map((i) => ({
    lineSubtotal: i.price * i.quantity,
    lineDiscount: i.price * i.quantity - i.itemTotal,
    taxAmount: i.taxAmount,
  }));
  // The coupon discount that belongs to the items that are still in the order
  const couponDiscount = active.reduce((sum, i) => sum + (i.couponShare || 0), 0);
  const totals = calculateTotals(lines, order.shippingFee, couponDiscount);
  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.couponDiscount = totals.couponDiscount;
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

// ---------- Public functions ----------

// 1. My orders (newest first) with search + status filter + pagination
const getMyOrders = async (userId, { search, status, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = { userId };
  if (status && Object.values(ORDER_STATUS).includes(status)) filter.status = status;

  // Search by order number OR by the name of any product in the order
  const text = search ? String(search).trim() : '';
  if (text) {
    const regex = new RegExp(escapeRegex(text), 'i');
    const matchingItems = await OrderItem.find({ name: regex }).select('orderId');
    filter.$or = [{ orderNumber: regex }, { _id: { $in: matchingItems.map((i) => i.orderId) } }];
  }

  const totalItems = await Order.countDocuments(filter);
  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const items = await OrderItem.find({ orderId: { $in: orders.map((o) => o._id) } });

  return {
    orders: orders.map((o) =>
      toOrderView(o, items.filter((i) => String(i.orderId) === String(o._id)))
    ),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
    },
  };
};

// 2. One order
const getMyOrder = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  const items = await OrderItem.find({ orderId: order._id });
  return toOrderView(order, items);
};

// 3. Cancel the whole order (only before it is shipped)
const cancelOrder = async (userId, orderRef, { reason } = {}) => {
  const cleanReason = cleanCancelReason(reason);
  const order = await findUserOrder(userId, orderRef);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.ORDER_ALREADY_CANCELLED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (order.status === ORDER_STATUS.DELIVERED) {
    throw createError(MESSAGES.ORDER.ORDER_ALREADY_DELIVERED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (order.status !== ORDER_STATUS.PENDING) {
    throw createError(MESSAGES.ORDER.CANNOT_CANCEL_AFTER_SHIPPED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  const items = await OrderItem.find({ orderId: order._id, status: ITEM_STATUS.PENDING });
  if (items.length === 0) {
    throw createError(MESSAGES.ORDER.ALL_ITEMS_ALREADY_CANCELLED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  for (const item of items) await cancelOneItem(item, cleanReason);
  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

// 4. Cancel one product of the order
const cancelOrderItem = async (userId, orderRef, itemId, { reason } = {}) => {
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }
  const cleanReason = cleanCancelReason(reason);
  const order = await findUserOrder(userId, orderRef);

  const item = await OrderItem.findOne({ _id: itemId, orderId: order._id });
  if (!item) {
    throw createError(MESSAGES.ORDER.ITEM_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_ITEM_NOT_FOUND);
  }
  if (item.status === ITEM_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.ITEM_ALREADY_CANCELLED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  if (item.status !== ITEM_STATUS.PENDING) {
    throw createError(MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

  await cancelOneItem(item, cleanReason);
  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

// 5. Return a delivered order (or only some of its items). Reason is mandatory.
const returnOrder = async (userId, orderRef, { reason, description, itemIds } = {}) => {
  if (reason === undefined || reason === null || String(reason).trim() === '') {
    throw createError(MESSAGES.ORDER.RETURN_REASON_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_REASON_REQUIRED);
  }
  const cleanReason = String(reason).trim();
  if (!RETURN_REASONS.includes(cleanReason)) {
    throw createError(MESSAGES.ORDER.INVALID_RETURN_REASON, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_REASON_REQUIRED);
  }
  const note = description ? String(description).trim().slice(0, 500) : null;

  const order = await findUserOrder(userId, orderRef);
  if (order.status !== ORDER_STATUS.DELIVERED) {
    throw createError(MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  const filter = { orderId: order._id, status: ITEM_STATUS.DELIVERED };
  if (Array.isArray(itemIds) && itemIds.length > 0) {
    if (!itemIds.every(isObjectId)) {
      throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
    }
    filter._id = { $in: itemIds };
  }

  const result = await OrderItem.updateMany(filter, {
    $set: {
      status: ITEM_STATUS.RETURN_REQUESTED,
      returnReason: cleanReason,
      returnDescription: note,
      returnRequestedAt: new Date(),
    },
    $push: { statusHistory: { status: ITEM_STATUS.RETURN_REQUESTED, note: cleanReason, updatedAt: new Date() } },
  });

  if (result.modifiedCount === 0) {
    throw createError(MESSAGES.ORDER.NO_RETURNABLE_ITEMS, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  return getMyOrder(userId, order._id);
};

// 6. Everything the invoice PDF needs (order must belong to the user and not be cancelled)
const getInvoiceData = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER, STATUS.BAD_REQUEST);
  }
  const items = await OrderItem.find({ orderId: order._id, status: { $ne: ITEM_STATUS.CANCELLED } });
  return { order, items };
};

module.exports = {
  getMyOrders,
  getMyOrder,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  getInvoiceData,
  // shared with the admin service
  toOrderView,
  refreshOrderAfterCancel,
  cancelOneItem,
};
