// src/services/user/orderService.js
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const {
  PRICING,
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

// Find an order by MongoDB ID or readable order number.
// The order must belong to the specified user.
const findUserOrder = async (userId, orderRef) => {
  if (!orderRef) {
    throw createError(
      MESSAGES.ORDER.INVALID_ORDER_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ORDER_ID
    );
  }

  const filter = isObjectId(orderRef)
    ? { _id: orderRef, userId }
    : { orderNumber: String(orderRef), userId };

  const order = await Order.findOne(filter);

  if (!order) {
    throw createError(
      MESSAGES.ORDER.ORDER_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.ORDER_NOT_FOUND
    );
  }

  return order;
};

const validItemId = (itemId) => {
  if (!isObjectId(itemId)) {
    throw createError(
      MESSAGES.ORDER.INVALID_ITEM_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ITEM_ID
    );
  }
};

// Cancellation reason is required.
// Supports both cancelReason and the older field name reason.
const cleanCancelReason = (body = {}) => {
  const raw =
    body.cancelReason !== undefined ? body.cancelReason : body.reason;

  const value =
    raw === undefined || raw === null ? '' : String(raw).trim();

  if (!value) {
    throw createError(
      MESSAGES.ORDER.CANCEL_REASON_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_REASON_REQUIRED
    );
  }

  if (value.length > MAX_REASON_LENGTH) {
    throw createError(
      MESSAGES.ORDER.CANCEL_REASON_TOO_LONG_FOR(MAX_REASON_LENGTH),
      STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  return value;
};

// Return reason is required.
// Supports returnReason / returnDescription and older reason / description.
const cleanReturnInput = (body = {}) => {
  const rawReason =
    body.returnReason !== undefined ? body.returnReason : body.reason;

  const reason =
    rawReason === undefined || rawReason === null
      ? ''
      : String(rawReason).trim();

  if (!reason) {
    throw createError(
      MESSAGES.ORDER.RETURN_REASON_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_REASON_REQUIRED
    );
  }

  if (reason.length > MAX_REASON_LENGTH) {
    throw createError(
      MESSAGES.ORDER.CANCEL_REASON_TOO_LONG_FOR(MAX_REASON_LENGTH),
      STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const rawNote =
    body.returnDescription !== undefined
      ? body.returnDescription
      : body.description;

  const description = rawNote
    ? String(rawNote).trim().slice(0, MAX_DESCRIPTION_LENGTH) || null
    : null;

  return { reason, description };
};

// Recalculate an order after cancellation.
// Original quantity stays unchanged; cancelledQuantity tracks cancelled units.

const refreshOrderAfterCancel = async (order, reason) => {
  const items = await OrderItem.find({ orderId: order._id });

  const active = items.filter(
    (item) => item.status !== ITEM_STATUS.CANCELLED
  );

  // If every item has been cancelled, cancel the whole order.
  if (active.length === 0) {
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelReason = reason || order.cancelReason;

    await order.save();
    return;
  }

  // Recalculate remaining item totals, discounts and taxes.
  const lines = active.map((item) => {
    const remainingQuantity = Math.max(
      0,
      Number(item.quantity) - (Number(item.cancelledQuantity) || 0)
    );

    const unitPrice = Number(item.price) || 0;
    const finalUnitPrice =
      Number(item.finalPrice ?? item.price) || 0;

    const lineSubtotal = unitPrice * remainingQuantity;
    const itemTotal = finalUnitPrice * remainingQuantity;
    const lineDiscount = Math.max(0, lineSubtotal - itemTotal);

    const taxAmount = Math.round(
      (itemTotal * PRICING.TAX_PERCENT) / 100
    );

    // Save updated totals for the remaining units.
    item.itemTotal = itemTotal;
    item.taxAmount = taxAmount;

    return {
      item,
      lineSubtotal,
      lineDiscount,
      taxAmount,
    };
  });

  // Save recalculated item totals.
  for (const line of lines) {
    await line.item.save();
  }

  // Recalculate order totals.
  const totals = calculateTotals(
    lines.map(({ lineSubtotal, lineDiscount, taxAmount }) => ({
      lineSubtotal,
      lineDiscount,
      taxAmount,
    })),
    order.shippingFee
  );

  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.taxTotal = totals.taxTotal;
  order.totalAmount = totals.totalAmount;

  await order.save();
};


// Cancel all remaining units of one pending item.
// The conditional update prevents duplicate stock restoration.

const cancelOneItem = async (item, reason) => {
  const alreadyCancelled = Number(item.cancelledQuantity) || 0;
  const remainingQuantity =
    Number(item.quantity) - alreadyCancelled;

  if (remainingQuantity <= 0) return false;

  const cancelled = await OrderItem.findOneAndUpdate(
    {
      _id: item._id,
      status: ITEM_STATUS.PENDING,
      cancelledQuantity: alreadyCancelled,
    },
    {
      $set: {
        status: ITEM_STATUS.CANCELLED,
        cancelledQuantity: item.quantity,
        cancelReason: reason,
        cancelledAt: new Date(),
      },
      $push: {
        statusHistory: {
          status: ITEM_STATUS.CANCELLED,
          note: reason || 'Cancelled by customer',
          updatedAt: new Date(),
        },
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!cancelled) return false;

  try {
    await restoreStock(
      cancelled.variantId,
      cancelled.size,
      remainingQuantity
    );
  } catch (error) {
    // Attempt to undo the item cancellation if stock restoration fails.
    await OrderItem.updateOne(
      {
        _id: cancelled._id,
        status: ITEM_STATUS.CANCELLED,
        cancelledQuantity: item.quantity,
      },
      {
        $set: {
          status: ITEM_STATUS.PENDING,
          cancelledQuantity: alreadyCancelled,
          cancelReason: item.cancelReason ?? null,
          cancelledAt: item.cancelledAt ?? null,
        },
      }
    );

    throw error;
  }

  return true;
};

// Determine delivery date for the return-window check.
const deliveredDate = (order, items) => {
  if (order.deliveredAt) {
    return new Date(order.deliveredAt);
  }

  const times = items
    .flatMap((item) => item.statusHistory || [])
    .filter(
      (history) =>
        history.status === ITEM_STATUS.DELIVERED && history.updatedAt
    )
    .map((history) => new Date(history.updatedAt).getTime());

  return times.length
    ? new Date(Math.max(...times))
    : new Date(order.updatedAt || order.createdAt);
};

// COD cancellation: no payment has been collected, so no refund is issued.
const NO_REFUND = Object.freeze({
  refundAmount: 0,
  refundedTo: null,
});

// ---------- Public functions ----------

// 1. My orders: search, status filter and pagination.
const getMyOrders = async (
  userId,
  { search, status, page, limit } = {}
) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  const limitNum = Math.min(
    Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const filter = { userId };

  const storedStatus = status ? toStoredStatus(status) : null;

  if (
    storedStatus &&
    Object.values(ORDER_STATUS).includes(storedStatus)
  ) {
    filter.status = storedStatus;
  }

  // Search by order number or product name.
  const text = search ? String(search).trim() : '';

  if (text) {
    const regex = new RegExp(escapeRegex(text), 'i');

    const matchingItems = await OrderItem.find({
      name: regex,
    }).select('orderId');

    filter.$or = [
      { orderNumber: regex },
      {
        _id: {
          $in: matchingItems.map((item) => item.orderId),
        },
      },
    ];
  }

  const totalResults = await Order.countDocuments(filter);

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const items = await OrderItem.find({
    orderId: { $in: orders.map((order) => order._id) },
  });

  return {
    orders: orders.map((order) =>
      toOrderListView(
        order,
        items.filter(
          (item) => String(item.orderId) === String(order._id)
        ),
        'user'
      )
    ),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalResults,
      totalPages: Math.ceil(totalResults / limitNum),
    },
  };
};

// 2. Get one order.
const getMyOrder = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);
  const items = await OrderItem.find({ orderId: order._id });

  return toOrderView(order, items, 'user');
};

// 2b. Order confirmation summary.
const getOrderSummary = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);

  const itemCount = await OrderItem.countDocuments({
    orderId: order._id,
  });

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


// 3. Cancel the whole order.

const cancelOrder = async (userId, orderRef, body = {}) => {
  const reason = cleanCancelReason(body);

  const order = await findUserOrder(userId, orderRef);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_CANCELLED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  if (order.status === ORDER_STATUS.DELIVERED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_DELIVERED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  if (order.status !== ORDER_STATUS.PENDING) {
    throw createError(
      MESSAGES.ORDER.CANNOT_CANCEL_AFTER_SHIPPED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  const items = await OrderItem.find({
    orderId: order._id,
    status: ITEM_STATUS.PENDING,
  });

  if (items.length === 0) {
    throw createError(
      MESSAGES.ORDER.ALL_ITEMS_ALREADY_CANCELLED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  for (const item of items) {
    const cancelled = await cancelOneItem(item, reason);

    if (!cancelled) {
      throw createError(
        MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED,
        STATUS.BAD_REQUEST,
        ERROR_CODES.CANCEL_NOT_ALLOWED
      );
    }
  }

  await refreshOrderAfterCancel(order, reason);

  const view = await getMyOrder(userId, order._id);

  return {
    orderId: view.id,
    status: view.status,
    ...NO_REFUND,
    order: view,
  };
};


// 4. Cancel a specified quantity of one item.
// Request body example:
// { "quantity": 1, "cancelReason": "Ordered by mistake" }
const cancelOrderItem = async (
  userId,
  orderRef,
  itemId,
  body = {}
) => {
  validItemId(itemId);

  const reason = cleanCancelReason(body);
  const quantity = Number(body.quantity);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(
      'Cancellation quantity must be a positive integer',
      STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  
  const order = await findUserOrder(userId, orderRef);

  if (order.status !== ORDER_STATUS.PENDING) {
    throw createError(
      MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  const item = await OrderItem.findOne({
    _id: itemId,
    orderId: order._id,
    status: ITEM_STATUS.PENDING,
  });

  if (!item) {
    throw createError(
      MESSAGES.ORDER.ITEM_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.ORDER_ITEM_NOT_FOUND
    );
  }

  const alreadyCancelled = Number(item.cancelledQuantity) || 0;
  const remainingQuantity =
    Number(item.quantity) - alreadyCancelled;

  if (quantity > remainingQuantity) {
    throw createError(
      `Only ${remainingQuantity} units are available for cancellation`,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const newCancelledQuantity = alreadyCancelled + quantity;
  const fullyCancelled =
    newCancelledQuantity === Number(item.quantity);
  const now = new Date();

  const updatedItem = await OrderItem.findOneAndUpdate(
    {
      _id: item._id,
      orderId: order._id,
      status: ITEM_STATUS.PENDING,
      $or: [
        { cancelledQuantity: alreadyCancelled },
        ...(alreadyCancelled === 0
          ? [{ cancelledQuantity: { $exists: false } }]
          : []),
      ],
    },
    {
      $set: {
        cancelledQuantity: newCancelledQuantity,
        cancelReason: reason,
        ...(fullyCancelled
          ? {
              status: ITEM_STATUS.CANCELLED,
              cancelledAt: now,
            }
          : {}),
      },
      $push: {
        statusHistory: {
          status: fullyCancelled
            ? ITEM_STATUS.CANCELLED
            : ITEM_STATUS.PENDING,
          note: `${quantity} unit(s) cancelled: ${reason}`,
          updatedAt: now,
        },
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedItem) {
    throw createError(
      'The item changed during cancellation. Please refresh and try again.',
      STATUS.BAD_REQUEST,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  try {
    await restoreStock(
      updatedItem.variantId,
      updatedItem.size,
      quantity
    );
  } catch (error) {
    // Attempt to revert the item update if stock restoration fails.
    await OrderItem.updateOne(
      {
        _id: updatedItem._id,
        cancelledQuantity: newCancelledQuantity,
        status: updatedItem.status,
      },
      {
        $set: {
          cancelledQuantity: alreadyCancelled,
          status: ITEM_STATUS.PENDING,
          cancelReason: item.cancelReason ?? null,
          cancelledAt: item.cancelledAt ?? null,
        },
      }
    );

    throw error;
  }

  await refreshOrderAfterCancel(order, reason);

  const view = await getMyOrder(userId, order._id);
  const itemView = view.items.find(
    (entry) => entry.orderItemId === String(updatedItem._id)
  );

  return {
    orderItemId: String(updatedItem._id),
    cancelledQuantity: newCancelledQuantity,
    remainingQuantity:
      Number(updatedItem.quantity) - newCancelledQuantity,
    status: itemView ? itemView.status : updatedItem.status,
    ...NO_REFUND,
    order: view,
  };
}

// 5. Request a return for a delivered order or selected delivered items.
// Return window is controlled by RETURN_WINDOW_DAYS.
const requestReturn = async (
  userId,
  orderRef,
  body = {},
  { itemIds = null, single = false } = {}
) => {
  const { reason, description } = cleanReturnInput(body);

  const order = await findUserOrder(userId, orderRef);

  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
    throw createError(
      MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  const filter = {
    orderId: order._id,
    status: ITEM_STATUS.DELIVERED,
  };

  if (Array.isArray(itemIds) && itemIds.length > 0) {
    if (!itemIds.every(isObjectId)) {
      throw createError(
        MESSAGES.ORDER.INVALID_ITEM_ID,
        STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_ITEM_ID
      );
    }

    filter._id = { $in: itemIds };
  }

  const allItems = await OrderItem.find({
    orderId: order._id,
  });

  if (
    new Date() >
    addDays(
      deliveredDate(order, allItems),
      RETURN_WINDOW_DAYS
    )
  ) {
    throw createError(
      single
        ? MESSAGES.ORDER.RETURN_ITEM_WINDOW_EXPIRED
        : MESSAGES.ORDER.RETURN_WINDOW_EXPIRED(RETURN_WINDOW_DAYS),
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_WINDOW_EXPIRED
    );
  }

  const now = new Date();

  const result = await OrderItem.updateMany(
    filter,
    {
      $set: {
        status: ITEM_STATUS.RETURN_REQUESTED,
        returnReason: reason,
        returnDescription: description,
        returnRequestedAt: now,
      },
      $push: {
        statusHistory: {
          status: ITEM_STATUS.RETURN_REQUESTED,
          note: reason,
          updatedAt: now,
        },
      },
    }
  );

  if (result.modifiedCount === 0) {
    throw createError(
      MESSAGES.ORDER.NO_RETURNABLE_ITEMS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  await syncReturnStatus(order);

  return getMyOrder(userId, order._id);
};

// POST /orders/:orderId/return
const returnOrder = async (
  userId,
  orderRef,
  body = {}
) => {
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds
    : null;

  const view = await requestReturn(
    userId,
    orderRef,
    body,
    { itemIds }
  );

  return {
    orderId: view.id,
    status: ITEM_STATUS.RETURN_REQUESTED,
    order: view,
  };
};

// POST /orders/:orderId/items/:orderItemId/return
const returnOrderItem = async (
  userId,
  orderRef,
  itemId,
  body = {}
) => {
  validItemId(itemId);

  const order = await findUserOrder(userId, orderRef);

  const item = await OrderItem.findOne({
    _id: itemId,
    orderId: order._id,
  });

  if (!item) {
    throw createError(
      MESSAGES.ORDER.ITEM_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.ORDER_ITEM_NOT_FOUND
    );
  }

  const view = await requestReturn(
    userId,
    orderRef,
    body,
    {
      itemIds: [String(item._id)],
      single: true,
    }
  );

  return {
    orderItemId: String(item._id),
    status: ITEM_STATUS.RETURN_REQUESTED,
    order: view,
  };
};

// 6. Invoice data.
// A cancelled order cannot have an invoice downloaded.
const getInvoiceData = async (userId, orderRef) => {
  const order = await findUserOrder(userId, orderRef);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BAD_REQUEST
    );
  }

  const items = await OrderItem.find({
    orderId: order._id,
    status: { $ne: ITEM_STATUS.CANCELLED },
  });

  return { order, items };
};

// Export public functions and shared helpers.
module.exports = {
  getMyOrders,
  getMyOrder,
  getOrderSummary,
  cancelOrder,
  cancelOrderItem,
  returnOrder,
  returnOrderItem,
  getInvoiceData,

  // Shared with the admin order service.
  toOrderView,
  refreshOrderAfterCancel,
  cancelOneItem,
};