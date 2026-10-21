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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Units of this item that are still part of the order (not cancelled)
const remainingQty = (item) => item.quantity - (item.cancelledQuantity || 0);

// Units of this item the customer can still ask to return
const returnableQty = (item) => {
  if (item.status !== ITEM_STATUS.DELIVERED) return 0;
  const delivered = item.deliveredQuantity || remainingQty(item);
  return Math.max(delivered - (item.returnedQuantity || 0) - (item.returnRequestedQuantity || 0), 0);
};

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

// Mandatory reason for returning: must be one of the list
const cleanReturnReason = (reason) => {
  if (reason === undefined || reason === null || String(reason).trim() === '') {
    throw createError(MESSAGES.ORDER.RETURN_REASON_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_REASON_REQUIRED);
  }
  const value = String(reason).trim();
  if (!RETURN_REASONS.includes(value)) {
    throw createError(MESSAGES.ORDER.INVALID_RETURN_REASON, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_REASON_REQUIRED);
  }
  return value;
};

// Quantity must be a whole number, 1 or more
const cleanQuantity = (value) => {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1) {
    throw createError(MESSAGES.ORDER.INVALID_QUANTITY, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_QUANTITY);
  }
  return qty;
};

const toItemView = (item) => {
  const remaining = remainingQty(item);
  const maxReturn = returnableQty(item);
  return {
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

    // quantity details
    cancelledQuantity: item.cancelledQuantity || 0,
    remainingQuantity: remaining,
    remainingTotal: round2((item.itemTotal / item.quantity) * remaining),
    returnRequestedQuantity: item.returnRequestedQuantity || 0,
    returnedQuantity: item.returnedQuantity || 0,

    cancelReason: item.cancelReason,
    cancelledAt: item.cancelledAt,
    returnReason: item.returnReason,
    returnDescription: item.returnDescription,
    returnRequestedAt: item.returnRequestedAt,
    statusHistory: item.statusHistory,

    canCancel: item.status === ITEM_STATUS.PENDING && remaining > 0,
    maxCancelQuantity: item.status === ITEM_STATUS.PENDING ? remaining : 0,
    canReturn: maxReturn > 0,
    maxReturnQuantity: maxReturn,
  };
};

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

// After units are cancelled: recalculate what the customer pays, or mark the whole order cancelled.
// Price, tax and coupon share of a partly cancelled item are cut in proportion to the units left.
const refreshOrderAfterCancel = async (order, reason) => {
  const items = await OrderItem.find({ orderId: order._id });
  const active = items.filter((i) => remainingQty(i) > 0);

  if (active.length === 0) {
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = reason || order.cancelReason;
    await order.save();
    // The whole order is gone, so the coupon use goes back to the user and the coupon
    await releaseCoupon(order.couponId);
    return;
  }

  let couponDiscount = 0;
  const lines = active.map((i) => {
    const remaining = remainingQty(i);
    const ratio = remaining / i.quantity;
    const lineSubtotal = i.price * remaining;
    const lineTotal = round2(i.itemTotal * ratio);
    couponDiscount += round2((i.couponShare || 0) * ratio);
    return {
      lineSubtotal,
      lineDiscount: round2(lineSubtotal - lineTotal),
      taxAmount: round2((i.taxAmount || 0) * ratio),
    };
  });

  const totals = calculateTotals(lines, order.shippingFee, round2(couponDiscount));
  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.couponDiscount = totals.couponDiscount;
  order.taxTotal = totals.taxTotal;
  order.totalAmount = totals.totalAmount;
  await order.save();
};

// Cancel `quantity` units of ONE item.
// The "not more than ordered" check is part of the update itself, so a double click
// can never cancel more than was ordered or give the stock back twice.
const cancelOneItem = async (item, quantity, reason) => {
  const now = new Date();
  const alreadyCancelled = { $ifNull: ['$cancelledQuantity', 0] };

  const cancelled = await OrderItem.findOneAndUpdate(
    {
      _id: item._id,
      status: ITEM_STATUS.PENDING,
      $expr: { $lte: [{ $add: [alreadyCancelled, quantity] }, '$quantity'] },
    },
    [
      // 1. add the units to cancelledQuantity
      {
        $set: {
          cancelledQuantity: { $add: [alreadyCancelled, quantity] },
          cancelReason: reason,
          cancelledAt: now,
        },
      },
      // 2. all units gone -> CANCELLED, otherwise it stays PENDING; add a history line
      {
        $set: {
          status: {
            $cond: [{ $gte: ['$cancelledQuantity', '$quantity'] }, ITEM_STATUS.CANCELLED, '$status'],
          },
          statusHistory: {
            $concatArrays: [
              { $ifNull: ['$statusHistory', []] },
              [
                {
                  status: {
                    $cond: [{ $gte: ['$cancelledQuantity', '$quantity'] }, ITEM_STATUS.CANCELLED, '$status'],
                  },
                  note: reason
                    ? `Cancelled ${quantity} unit(s): ${reason}`
                    : `Cancelled ${quantity} unit(s) by customer`,
                  updatedAt: now,
                },
              ],
            ],
          },
        },
      },
    ],
    { new: true , updatePipeline : true}
  );
  if (!cancelled) return false;

  await restoreStock(item.variantId, item.size, quantity);
  return true;
};

// Ask to return `quantity` units of ONE delivered item.
// The DELIVERED status is checked inside the update, so the same item cannot be requested twice.
const requestItemReturn = async (item, quantity, reason, note) => {
  const now = new Date();
  const updated = await OrderItem.findOneAndUpdate(
    { _id: item._id, status: ITEM_STATUS.DELIVERED },
    {
      $set: {
        status: ITEM_STATUS.RETURN_REQUESTED,
        returnRequestedQuantity: quantity,
        returnReason: reason,
        returnDescription: note,
        returnRequestedAt: now,
      },
      $push: {
        statusHistory: {
          status: ITEM_STATUS.RETURN_REQUESTED,
          note: `Return requested for ${quantity} unit(s): ${reason}`,
          updatedAt: now,
        },
      },
    },
    { new: true }
  );
  return Boolean(updated);
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

// 3. Cancel the whole order (only before it is shipped).
//    Every pending item is cancelled with all of its remaining units.
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

  for (const item of items) {
    const qty = remainingQty(item);
    if (qty > 0) await cancelOneItem(item, qty, cleanReason);
  }
  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

// 4. Cancel some (or all) units of one product of the order. Quantity is required.
const cancelOrderItem = async (userId, orderRef, itemId, { quantity, reason } = {}) => {
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }
  const qty = cleanQuantity(quantity);
  const cleanReason = cleanCancelReason(reason);
  const order = await findUserOrder(userId, orderRef);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.ORDER_ALREADY_CANCELLED, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }

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
  if (qty > remainingQty(item)) {
    throw createError(MESSAGES.ORDER.CANCEL_QUANTITY_EXCEEDS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_QUANTITY);
  }

  const done = await cancelOneItem(item, qty, cleanReason);
  if (!done) {
    // Someone else changed the item between our check and the update
    throw createError(MESSAGES.ORDER.CANCEL_QUANTITY_EXCEEDS, STATUS.CONFLICT, ERROR_CODES.CANCEL_NOT_ALLOWED);
  }
  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

// 5. Return the whole delivered order (or only some of its items) in full. Reason is mandatory.
//    Every chosen item is returned with all of its returnable units.
const returnOrder = async (userId, orderRef, { reason, description, itemIds } = {}) => {
  const cleanReason = cleanReturnReason(reason);
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

  const items = await OrderItem.find(filter);
  let requested = 0;
  for (const item of items) {
    const qty = returnableQty(item);
    if (qty > 0 && (await requestItemReturn(item, qty, cleanReason, note))) requested += 1;
  }

  if (requested === 0) {
    throw createError(MESSAGES.ORDER.NO_RETURNABLE_ITEMS, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  return getMyOrder(userId, order._id);
};

// 6. Return some (or all) units of one delivered product. Quantity and reason are required.
const returnOrderItem = async (userId, orderRef, itemId, { quantity, reason, description } = {}) => {
  if (!isObjectId(itemId)) {
    throw createError(MESSAGES.ORDER.INVALID_ITEM_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ITEM_ID);
  }
  const qty = cleanQuantity(quantity);
  const cleanReason = cleanReturnReason(reason);
  const note = description ? String(description).trim().slice(0, 500) : null;

  const order = await findUserOrder(userId, orderRef);
  if (order.status !== ORDER_STATUS.DELIVERED) {
    throw createError(MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  const item = await OrderItem.findOne({ _id: itemId, orderId: order._id });
  if (!item) {
    throw createError(MESSAGES.ORDER.ITEM_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ORDER_ITEM_NOT_FOUND);
  }

  const maxQty = returnableQty(item);
  if (maxQty === 0) {
    throw createError(MESSAGES.ORDER.NO_RETURNABLE_ITEMS, STATUS.BAD_REQUEST, ERROR_CODES.RETURN_NOT_ALLOWED);
  }
  if (qty > maxQty) {
    throw createError(MESSAGES.ORDER.RETURN_QUANTITY_EXCEEDS, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_QUANTITY);
  }

  const done = await requestItemReturn(item, qty, cleanReason, note);
  if (!done) {
    throw createError(MESSAGES.ORDER.NO_RETURNABLE_ITEMS, STATUS.CONFLICT, ERROR_CODES.RETURN_NOT_ALLOWED);
  }

  return getMyOrder(userId, order._id);
};

// 7. Everything the invoice PDF needs (order must belong to the user and not be cancelled).
//    Items come back as plain objects with only the units that were NOT cancelled.
const getInvoiceData = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER, STATUS.BAD_REQUEST);
  }
  const allItems = await OrderItem.find({ orderId: order._id, status: { $ne: ITEM_STATUS.CANCELLED } });

  const items = allItems.map((item) => {
    const remaining = remainingQty(item);
    const ratio = remaining / item.quantity;
    return {
      ...item.toObject(),
      quantity: remaining,
      itemTotal: round2(item.itemTotal * ratio),
      taxAmount: round2((item.taxAmount || 0) * ratio),
    };
  });

  return { order, items };
};

module.exports = {
  getMyOrders,
  getMyOrder,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  returnOrderItem,
  getInvoiceData,

  toOrderView,
  refreshOrderAfterCancel,
  cancelOneItem,
};