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
  isDamageReturnReason,
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

// Get orders
const getOrders = async ({ search, status, sort, from, to, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = { $nor: [unpaidOnlineFilter()] };

  const returnOrderIds = await OrderItem.distinct('orderId', { status: ITEM_STATUS.RETURN_REQUESTED });

  if (status === ITEM_STATUS.RETURN_REQUESTED) {
    filter._id = { $in: returnOrderIds };
  } else if (status && Object.values(ORDER_STATUS).includes(status)) {
    filter.status = status;
  }

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

const OPEN_ITEM_STATUSES = [ITEM_STATUS.PENDING, ITEM_STATUS.SHIPPED, ITEM_STATUS.OUT_FOR_DELIVERY];

const isPayable = (order) => order.paymentMethod === PAYMENT_METHODS.COD || order.paymentStatus === PAYMENT_STATUS.PAID;

const nextStatuses = (order, current) => {
  const next = STATUS_TRANSITIONS[current] || [];
  return isPayable(order) ? next : next.filter((s) => s === ORDER_STATUS.CANCELLED);
};

const itemAllowedStatuses = (order, item) => {
  if (!OPEN_ITEM_STATUSES.includes(item.status) || remainingQuantity(item) < 1) return [];
  return nextStatuses(order, item.status);
};

// Get order
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
        returnIsDamage: isDamageReturnReason(raw.returnReason),
      };
    }),
    user: toUserView(user),
  };
};

const conflict = (message) => createError(message, STATUS.CONFLICT, ERROR_CODES.INVALID_STATUS_TRANSITION);

const checkItemChange = (order, item, newStatus) => {
  const current = item.status;

  if (current === ITEM_STATUS.DELIVERED) throw conflict(MESSAGES.ORDER.ITEM_ALREADY_DELIVERED);
  if (current === ITEM_STATUS.CANCELLED) throw conflict(MESSAGES.ORDER.ITEM_ALREADY_CANCELLED);
  if (!OPEN_ITEM_STATUSES.includes(current)) throw conflict(MESSAGES.ORDER.ITEM_HAS_RETURN);

  if (newStatus === current) throw conflict(MESSAGES.ORDER.INVALID_STATUS_TRANSITION(current, newStatus));

  const allowed = STATUS_TRANSITIONS[current] || [];
  if (!allowed.includes(newStatus)) {
    throw conflict(MESSAGES.ORDER.STATUS_STEP_NOT_ALLOWED(current, newStatus, allowed));
  }

  if (newStatus === ORDER_STATUS.CANCELLED) return;
  if (!isPayable(order)) throw conflict(MESSAGES.ORDER.PAYMENT_NOT_RECEIVED);
};

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
  if (newStatus === ORDER_STATUS.DELIVERED) $set.deliveredQuantity = remainingQuantity(item);

  const done = await OrderItem.findOneAndUpdate(
    { _id: item._id, status: item.status },
    { $set, $push: { statusHistory: { $each: history } } }
  );
  if (!done) throw conflict(MESSAGES.ORDER.ITEM_STATUS_CHANGED_ELSEWHERE);
};

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

const finishChange = (order, cancelled) =>
  cancelled ? refreshOrderAfterCancel(order, 'Cancelled by admin') : syncOrderStatus(order._id);

// Item status
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

// Order status
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
    if (changed > 0) await finishChange(order, cancelled);
  }

  return getOrder(order._id);
};

// Handle return
const handleReturn = async (orderRef, itemId, action, reason, restock) => {
  if (!['approve', 'reject'].includes(action)) {
    throw createError(MESSAGES.ORDER.INVALID_RETURN_ACTION, STATUS.BAD_REQUEST);
  }
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }

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

  const requestedQty = item.returnRequestedQuantity || item.quantity - (item.cancelledQuantity || 0);

  let addToStock = false;
  if (action === 'approve') {
    if (isDamageReturnReason(item.returnReason)) {
      addToStock = false;
    } else if (restock === undefined || restock === null || restock === '') {
      throw createError(
        'Check the return reason and description, then choose whether the units go back to stock.',
        STATUS.BAD_REQUEST
      );
    } else {
      addToStock = restock === true || restock === 'true';
    }
  }

  if (action === 'approve') {
    item.returnedQuantity = (item.returnedQuantity || 0) + requestedQty;
    item.returnRequestedQuantity = 0;

    if (addToStock) item.returnRestockedQuantity = (item.returnRestockedQuantity || 0) + requestedQty;
    else item.returnDiscardedQuantity = (item.returnDiscardedQuantity || 0) + requestedQty;

    const delivered = item.deliveredQuantity || item.quantity - (item.cancelledQuantity || 0);
    item.status = item.returnedQuantity >= delivered ? ITEM_STATUS.RETURNED : ITEM_STATUS.DELIVERED;

    pushHistory(
      item,
      ITEM_STATUS.RETURNED,
      `Return approved for ${requestedQty} unit(s), ${addToStock ? 'added back to stock' : 'not added to stock'}`
    );
    await item.save();
    if (addToStock) await restoreStock(item.variantId, item.size, requestedQty);

    if (item.quantity > 0) {
      const perUnit =
        (item.itemTotal - (item.couponShare || 0) - (item.referralShare || 0) + (item.taxAmount || 0)) / item.quantity;
      await refundOrder(order, Math.round(perUnit * requestedQty * 100) / 100, {
        reason: 'return',
        note: `${item.name} x${requestedQty}`,
      });
    }
  } else {
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
