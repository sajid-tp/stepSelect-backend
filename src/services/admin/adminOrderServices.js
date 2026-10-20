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
  MAX_SHIPPING_TEXT_LENGTH,
  toPublicStatus,
  toStoredStatus,
} = require('../../constants/orderConstants');
const { isObjectId, escapeRegex, restoreStock, syncReturnStatus } = require('../../utils/orderHelpers');
const { toOrderView } = require('../../utils/orderViews');

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
    throw createError(MESSAGES.ORDER.ADMIN_ORDER_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_NOT_FOUND);
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

  const filter = {};

  // processing is the admin name for a new order (stored as pending)
  const storedStatus = status ? toStoredStatus(status) : null;
  if (storedStatus && Object.values(ORDER_STATUS).includes(storedStatus)) filter.status = storedStatus;

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

  const totalResults = await Order.countDocuments(filter);
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
      customerName: o.userId ? o.userId.username || '' : '',
      customerEmail: o.userId ? o.userId.email || '' : '',
      totalAmount: o.totalAmount,
      placedAt: o.createdAt,
      createdAt: o.createdAt,
      status: toPublicStatus(o.status, 'admin'),
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      itemCount: (counts.find((c) => String(c._id) === String(o._id)) || {}).count || 0,
      user: toUserView(o.userId),
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalResults,
      totalPages: Math.ceil(totalResults / limitNum) || 1,
    },
  };
};

// 2. One order with customer details (Edit Order screen)
const getOrder = async (orderRef) => {
  const order = await findOrder(orderRef);
  const [items, user] = await Promise.all([
    OrderItem.find({ orderId: order._id }),
    User.findById(order.userId).select('username email phoneNumber'),
  ]);

  const view = toOrderView(order, items, 'admin');
  const a = order.shippingAddress || {};
  const nextIndex = STATUS_FLOW.indexOf(order.status) + 1;
  const canChange = STATUS_FLOW.includes(order.status) && order.status !== ORDER_STATUS.DELIVERED;

  return {
    ...view,
    user: toUserView(user),
    // Shipping block of the Edit Order screen
    shipping: {
      fullName: a.name || '',
      phoneNumber: a.phoneNumber || '',
      address: [a.detailedAddress, a.city, a.pinCode, a.country].filter(Boolean).join(', '),
      carrier: order.carrier || '',
      trackingId: order.trackingId || '',
    },
    // Statuses the admin dropdown can offer right now
    allowedStatuses: canChange
      ? [...STATUS_FLOW.slice(nextIndex), ORDER_STATUS.CANCELLED].map((st) => toPublicStatus(st, 'admin'))
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

// 3. Update an order: status, payment status, carrier and tracking id, any of them, in one call.
//    Status moves forward only: processing -> shipped -> out_for_delivery -> delivered. Cancel is allowed before delivery.
//    ("processing" is the admin name for a new order; it is stored as "pending".)
const ADMIN_STATUS_TARGETS = [...STATUS_FLOW, ORDER_STATUS.CANCELLED];

const invalidTransition = (current, target) =>
  createError(
    MESSAGES.ORDER.INVALID_STATUS_TRANSITION(toPublicStatus(current, 'admin'), toPublicStatus(target, 'admin')),
    STATUS.CONFLICT,
    ERROR_CODES.INVALID_STATUS_TRANSITION
  );

const assertCanMoveTo = (current, target) => {
  if (!STATUS_FLOW.includes(current) || current === ORDER_STATUS.DELIVERED || target === current) {
    throw invalidTransition(current, target);
  }
  if (target !== ORDER_STATUS.CANCELLED && STATUS_FLOW.indexOf(target) <= STATUS_FLOW.indexOf(current)) {
    throw invalidTransition(current, target);
  }
};

// carrier / trackingId: text, empty or null clears it
const cleanShippingText = (value, field) => {
  const text = value === null ? '' : String(value).trim();
  if (text.length > MAX_SHIPPING_TEXT_LENGTH) {
    throw createError(
      MESSAGES.ORDER.INVALID_SHIPPING_FIELD(field, MAX_SHIPPING_TEXT_LENGTH),
      STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return text;
};

// Internal Helper: move the order and its live items to the new status (the caller saves the order)
const applyStatusChange = async (order, newStatus) => {
  if (newStatus === ORDER_STATUS.CANCELLED) {
    await cancelAllOpenItems(order, 'Cancelled by admin');
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = 'Cancelled by admin';
    return;
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
    order.paymentStatus = PAYMENT_STATUS.PAID; // cash collected on delivery
  }
};

const updateOrder = async (orderRef, body = {}) => {
  const { status, paymentStatus, carrier, trackingId } = body;
  const given = (v) => v !== undefined;

  if (![status, paymentStatus, carrier, trackingId].some(given)) {
    throw createError(MESSAGES.ORDER.NOTHING_TO_UPDATE, STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  // Check every field first, so a bad value changes nothing
  let newStatus;
  if (given(status)) {
    newStatus = toStoredStatus(status);
    if (!ADMIN_STATUS_TARGETS.includes(newStatus)) {
      throw createError(MESSAGES.ORDER.INVALID_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_STATUS);
    }
  }
  if (given(paymentStatus) && !Object.values(PAYMENT_STATUS).includes(paymentStatus)) {
    throw createError(MESSAGES.ORDER.INVALID_PAYMENT_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PAYMENT_STATUS);
  }
  const newCarrier = given(carrier) ? cleanShippingText(carrier, 'carrier') : undefined;
  const newTracking = given(trackingId) ? cleanShippingText(trackingId, 'trackingId') : undefined;

  const order = await findOrder(orderRef);

  // "Save changes" on the Edit Order screen sends the current status again: that is not a status change,
  // as long as something else is being saved with it.
  const savingOtherFields = [paymentStatus, carrier, trackingId].some(given);
  const changeStatus = given(status) && !(newStatus === order.status && savingOtherFields);
  if (changeStatus) assertCanMoveTo(order.status, newStatus);

  if (changeStatus) await applyStatusChange(order, newStatus);
  if (given(paymentStatus)) order.paymentStatus = paymentStatus; // an explicit value wins over the automatic "paid"
  if (newCarrier !== undefined) order.carrier = newCarrier;
  if (newTracking !== undefined) order.trackingId = newTracking;
  await order.save();

  return getOrder(order._id);
};

// PATCH /:orderId/status (older route): only the status
const updateOrderStatus = async (orderRef, newStatus) => {
  if (newStatus === undefined || newStatus === null || String(newStatus).trim() === '') {
    throw createError(MESSAGES.ORDER.INVALID_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_STATUS);
  }
  return updateOrder(orderRef, { status: newStatus });
};

// 4. Approve or reject a return request for one item
const handleReturn = async (orderRef, itemId, action) => {
  if (!['approve', 'reject'].includes(action)) {
    throw createError(MESSAGES.ORDER.INVALID_RETURN_ACTION, STATUS.BAD_REQUEST);
  }
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }

  const order = await findOrder(orderRef);
  const newStatus = action === 'approve' ? ITEM_STATUS.RETURNED : ITEM_STATUS.RETURN_REJECTED;

  const item = await OrderItem.findOneAndUpdate(
    { _id: itemId, orderId: order._id, status: ITEM_STATUS.RETURN_REQUESTED },
    {
      $set: { status: newStatus },
      $push: { statusHistory: { status: newStatus, note: 'Updated by admin', updatedAt: new Date() } },
    },
    { new: true }
  );
  if (!item) {
    throw createError(MESSAGES.ORDER.NO_RETURN_REQUEST_FOR_ITEM, STATUS.CONFLICT, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  if (action === 'approve') {
    item.returnedQuantity = item.quantity;
    await item.save();
    await restoreStock(item.variantId, item.size, item.quantity); // shoes go back on the shelf
  }

  await syncReturnStatus(order);
  return getOrder(order._id);
};

module.exports = { getOrders, getOrder, updateOrder, updateOrderStatus, handleReturn };
