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
  STATUS_TRANSITIONS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');
const { isObjectId, escapeRegex, restoreStock, pushHistory, remainingQuantity } = require('../../utils/orderHelpers');
const { toOrderView, refreshOrderAfterCancel, syncOrderStatus } = require('../user/orderService');
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

  // Orders that have a product waiting for the admin to approve / reject its return.
  // (also gives the number shown on the "Returns" tab, whatever the other filters are)
  const returnOrderIds = await OrderItem.distinct('orderId', { status: ITEM_STATUS.RETURN_REQUESTED });

  if (status === ITEM_STATUS.RETURN_REQUESTED) {
    // the "Returns" tab
    filter._id = { $in: returnOrderIds };
  } else if (status && Object.values(ORDER_STATUS).includes(status)) {
    filter.status = status;
  }

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
    {
      $group: {
        _id: '$orderId',
        count: { $sum: 1 },
        returnRequests: { $sum: { $cond: [{ $eq: ['$status', ITEM_STATUS.RETURN_REQUESTED] }, 1, 0] } },
      },
    },
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
      // products of this order whose return the admin still has to decide on (orange pill in the list)
      returnRequestCount: (counts.find((c) => String(c._id) === String(o._id)) || {}).returnRequests || 0,
      user: toUserView(o.userId),
    })),
    pendingReturnOrders: returnOrderIds.length,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

// Item statuses the admin can still move on from. Delivered is final (after that the customer may ask for a return).
const OPEN_ITEM_STATUSES = [ITEM_STATUS.PENDING, ITEM_STATUS.SHIPPED, ITEM_STATUS.OUT_FOR_DELIVERY];

// An online order can only move forward once its payment has arrived (Cash on Delivery pays at the door)
const isPayable = (order) => order.paymentMethod === PAYMENT_METHODS.COD || order.paymentStatus === PAYMENT_STATUS.PAID;

// The statuses ONE product may move to next, straight from the STATUS_TRANSITIONS table
// (an unpaid online order can only be cancelled, never shipped).
const nextStatuses = (order, current) => {
  const next = STATUS_TRANSITIONS[current] || [];
  return isPayable(order) ? next : next.filter((s) => s === ORDER_STATUS.CANCELLED);
};

// What the status dropdown of ONE product can offer right now.
const itemAllowedStatuses = (order, item) => {
  if (!OPEN_ITEM_STATUSES.includes(item.status) || remainingQuantity(item) < 1) return [];
  return nextStatuses(order, item.status);
};

// 2. One order with customer details. Every item carries its own `allowedStatuses`.
const getOrder = async (orderRef) => {
  const order = await findOrder(orderRef);
  const [items, user] = await Promise.all([
    OrderItem.find({ orderId: order._id }),
    User.findById(order.userId).select('username email phoneNumber'),
  ]);

  const view = toOrderView(order, items);
  const rawById = new Map(items.map((i) => [String(i._id), i]));

  return {
    ...view,
    items: view.items.map((v) => {
      const raw = rawById.get(v.id);
      return {
        ...v,
        allowedStatuses: itemAllowedStatuses(order, raw),
        returnRestockedQuantity: raw.returnRestockedQuantity || 0,
        returnDiscardedQuantity: raw.returnDiscardedQuantity || 0,
      };
    }),
    user: toUserView(user),
  };
};

const conflict = (message) => createError(message, STATUS.CONFLICT, ERROR_CODES.INVALID_STATUS_TRANSITION);

// Can this item go to `newStatus`? Throws a readable error when it cannot.
const checkItemChange = (order, item, newStatus) => {
  const current = item.status;

  if (current === ITEM_STATUS.DELIVERED) throw conflict(MESSAGES.ORDER.ITEM_ALREADY_DELIVERED);
  if (current === ITEM_STATUS.CANCELLED) throw conflict(MESSAGES.ORDER.ITEM_ALREADY_CANCELLED);
  if (!OPEN_ITEM_STATUSES.includes(current)) throw conflict(MESSAGES.ORDER.ITEM_HAS_RETURN);

  if (newStatus === current) throw conflict(MESSAGES.ORDER.INVALID_STATUS_TRANSITION(current, newStatus));

  // The one rule: the new status must be a step the table allows from the current status.
  // (this blocks skipping ahead, going back, and cancelling once the item has shipped)
  const allowed = STATUS_TRANSITIONS[current] || [];
  if (!allowed.includes(newStatus)) {
    throw conflict(MESSAGES.ORDER.STATUS_STEP_NOT_ALLOWED(current, newStatus, allowed));
  }

  if (newStatus === ORDER_STATUS.CANCELLED) return;
  if (!isPayable(order)) throw conflict(MESSAGES.ORDER.PAYMENT_NOT_RECEIVED);
};

// Move ONE item forward (the step was already checked against STATUS_TRANSITIONS). Every stage it passes
// gets a history line, so the customer's "Track item" timeline has no gaps, even when the admin goes
// straight from shipped to delivered and skips the optional "out for delivery" step.
const moveItemForward = async (item, newStatus) => {
  const from = STATUS_FLOW.indexOf(item.status);
  const to = STATUS_FLOW.indexOf(newStatus);
  const now = new Date();

  const history = STATUS_FLOW.slice(from + 1, to + 1).map((status) => ({
    status,
    note: 'Updated by admin',
    updatedAt: now,
  }));

  const $set = { status: newStatus };
  if (newStatus === ORDER_STATUS.DELIVERED) $set.deliveredQuantity = remainingQuantity(item); // cancelled units were never delivered

  // Only matches while the item is still where we saw it, so two admins cannot apply the same step twice
  const done = await OrderItem.findOneAndUpdate(
    { _id: item._id, status: item.status },
    { $set, $push: { statusHistory: { $each: history } } }
  );
  if (!done) throw conflict(MESSAGES.ORDER.ITEM_STATUS_CHANGED_ELSEWHERE);
};

// Cancel ONE item (all units that are left) and put the shoes back on the shelf.
// Prices, coupon share and the refund are worked out afterwards by refreshOrderAfterCancel.
const cancelItemByAdmin = async (item) => {
  const left = remainingQuantity(item);
  const now = new Date();

  const done = await OrderItem.findOneAndUpdate(
    { _id: item._id, status: item.status },
    {
      $set: { status: ITEM_STATUS.CANCELLED, cancelledQuantity: item.quantity, cancelReason: 'Cancelled by admin', cancelledAt: now },
      $push: { statusHistory: { status: ITEM_STATUS.CANCELLED, note: `Cancelled ${left} unit(s) by admin`, updatedAt: now } },
    }
  );
  if (!done) throw conflict(MESSAGES.ORDER.ITEM_STATUS_CHANGED_ELSEWHERE);

  await restoreStock(item.variantId, item.size, left);
};

// After items changed: recount the order (totals + refund for cancels) or just follow the items' status
const finishChange = (order, cancelled) =>
  cancelled ? refreshOrderAfterCancel(order, 'Cancelled by admin') : syncOrderStatus(order._id);

// 3. Change the status of ONE product of an order (the admin's main action).
//    Only the steps in STATUS_TRANSITIONS are allowed: pending -> shipped -> (out_for_delivery) -> delivered,
//    or cancelled while still pending. The order's own status then follows its items by itself.
const updateItemStatus = async (orderRef, itemId, newStatus) => {
  if (!Object.values(ORDER_STATUS).includes(newStatus)) {
    throw createError(MESSAGES.ORDER.INVALID_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_STATUS);
  }
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }

  const order = await findOrder(orderRef);
  const item = await OrderItem.findOne({ _id: itemId, orderId: order._id });
  if (!item) {
    throw createError(MESSAGES.ORDER.ITEM_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_ITEM_NOT_FOUND);
  }

  checkItemChange(order, item, newStatus);

  const cancelled = newStatus === ORDER_STATUS.CANCELLED;
  if (cancelled) await cancelItemByAdmin(item);
  else await moveItemForward(item, newStatus);

  await finishChange(order, cancelled);
  return getOrder(order._id);
};

// Same thing for every open item at once (kept for the shorter Postman route PATCH /orders/:orderId).
// Only items for which `newStatus` is an allowed next step are changed; every other item
// (already past it, too early for it, delivered, cancelled or in a return) is left alone.
const updateOrderStatus = async (orderRef, newStatus) => {
  if (!Object.values(ORDER_STATUS).includes(newStatus)) {
    throw createError(MESSAGES.ORDER.INVALID_STATUS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ORDER_STATUS);
  }

  const order = await findOrder(orderRef);
  const cancelled = newStatus === ORDER_STATUS.CANCELLED;

  const openItems = await OrderItem.find({ orderId: order._id, status: { $in: OPEN_ITEM_STATUSES } });
  const targets = openItems.filter((i) => (STATUS_TRANSITIONS[i.status] || []).includes(newStatus));

  if (targets.length === 0) {
    throw conflict(MESSAGES.ORDER.INVALID_STATUS_TRANSITION(order.status, newStatus));
  }
  if (!cancelled && !isPayable(order)) throw conflict(MESSAGES.ORDER.PAYMENT_NOT_RECEIVED);

  let changed = 0;
  try {
    for (const item of targets) {
      if (cancelled) await cancelItemByAdmin(item);
      else await moveItemForward(item, newStatus);
      changed += 1;
    }
  } finally {
    // even if one item failed, the items that did move must be counted / refunded
    if (changed > 0) await finishChange(order, cancelled);
  }

  return getOrder(order._id);
};

// 4. Approve or reject a return request for one item.
//    On approve, `restock` tells whether the returned units go back into the shop's stock
//    (false for e.g. damaged shoes). It defaults to true, which is how returns always worked.
const handleReturn = async (orderRef, itemId, action, reason, restock) => {
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

  const addToStock = restock !== false && restock !== 'false';

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

    // keep a record of the admin's stock decision for these units
    if (addToStock) item.returnRestockedQuantity = (item.returnRestockedQuantity || 0) + requestedQty;
    else item.returnDiscardedQuantity = (item.returnDiscardedQuantity || 0) + requestedQty;

    // Everything returned -> "returned". Only some units returned -> back to "delivered"
    // so the customer can still return the rest later.
    const delivered = item.deliveredQuantity || item.quantity - (item.cancelledQuantity || 0);
    item.status = item.returnedQuantity >= delivered ? ITEM_STATUS.RETURNED : ITEM_STATUS.DELIVERED;

    pushHistory(item, ITEM_STATUS.RETURNED, `Return approved for ${requestedQty} unit(s)`);
    await item.save();
    if (addToStock) await restoreStock(item.variantId, item.size, requestedQty); // shoes go back on the shelf

    // The admin approved the return: put what these units cost (after their share of the coupon,
    // plus tax) into the customer's wallet. This also covers Cash on Delivery orders.
    if (item.quantity > 0) {
      const perUnit =
        (item.itemTotal - (item.couponShare || 0) - (item.referralShare || 0) + (item.taxAmount || 0)) / item.quantity;
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

module.exports = { getOrders, getOrder, updateItemStatus, updateOrderStatus, handleReturn };
