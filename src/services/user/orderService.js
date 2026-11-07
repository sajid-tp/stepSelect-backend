
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');

const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const {
  ORDER_STATUS,
  ITEM_STATUS,
  STATUS_FLOW,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  CANCEL_REASONS,
  RETURN_REASONS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');

const {
  isObjectId,
  escapeRegex,
  calculateTotals,
  restoreStock,
  deriveOrderStatus,
} = require('../../utils/orderHelpers');

const { releaseCoupon } = require('./couponService');
const { refundOrder } = require('../payment/refundService');
const { describeRetryState, getDisplayStatus, isUnpaidOnline } = require('../payment/paymentRules');
const referralService = require('./referralService');



const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;


const round2 = (number) => {
  return Math.round((Number(number) || 0) * 100) / 100;
};



const getRemainingQuantity = (item) => {
  const cancelledQuantity = item.cancelledQuantity || 0;

  return item.quantity - cancelledQuantity;
};



// Cancelling the WHOLE order is only possible while every item is still being processed (nothing shipped yet).
// As soon as ANY item has left processing (shipped, out for delivery, delivered, or in the return flow)
// "Cancel order" is closed. A single item that is still processing can still be cancelled on its own.
// (The order status alone is not enough: it follows the slowest item, so an order with one shipped
// pair and one pair still packing still says "pending".)
const hasLeftProcessing = (items) =>
  items.some(
    (item) =>
      item.status !== ITEM_STATUS.PENDING && item.status !== ITEM_STATUS.CANCELLED
  );

const getReturnableQuantity = (item) => {
  if (item.status !== ITEM_STATUS.DELIVERED) {
    return 0;
  }

  const deliveredQuantity =
    item.deliveredQuantity || getRemainingQuantity(item);

  const returnedQuantity = item.returnedQuantity || 0;
  const requestedQuantity = item.returnRequestedQuantity || 0;

  const quantityAvailable =
    deliveredQuantity - returnedQuantity - requestedQuantity;

  return Math.max(quantityAvailable, 0);
};


const findUserOrder = async (userId, orderRef) => {
  if (!orderRef) {
    throw createError(
      MESSAGES.ORDER.INVALID_ORDER_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ORDER_ID
    );
  }

  let order;


  if (isObjectId(orderRef)) {
    order = await Order.findOne({
      _id: orderRef,
      userId,
    });
  } else {
    order = await Order.findOne({
      orderNumber: String(orderRef),
      userId,
    });
  }

  if (!order) {
    throw createError(
      MESSAGES.ORDER.ORDER_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.ORDER_NOT_FOUND
    );
  }

  return order;
};



const assertNotUnpaidOnline = (order) => {
  if (isUnpaidOnline(order)) {
    throw createError(
      'The payment for this order is not completed. Retry or cancel the payment instead.',
      STATUS.CONFLICT
    );
  }
};

const getCancelReason = (reason) => {
  if (reason === undefined || reason === null || String(reason).trim() === '') {
    return null;
  }

  const cleanReason = String(reason).trim();

  if (!CANCEL_REASONS.includes(cleanReason)) {
    throw createError(
      MESSAGES.ORDER.INVALID_CANCEL_REASON,
      STATUS.BAD_REQUEST
    );
  }

  return cleanReason;
};



const getReturnReason = (reason) => {
  if (reason === undefined || reason === null || String(reason).trim() === '') {
    throw createError(
      MESSAGES.ORDER.RETURN_REASON_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_REASON_REQUIRED
    );
  }

  const cleanReason = String(reason).trim();

  if (!RETURN_REASONS.includes(cleanReason)) {
    throw createError(
      MESSAGES.ORDER.INVALID_RETURN_REASON,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_REASON_REQUIRED
    );
  }

  return cleanReason;
};



const getValidQuantity = (quantity) => {
  const number = Number(quantity);

  if (!Number.isInteger(number) || number < 1) {
    throw createError(
      MESSAGES.ORDER.INVALID_QUANTITY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_QUANTITY
    );
  }

  return number;
};


const getReturnDescription = (description) => {
  if (!description) {
    return null;
  }

  return String(description).trim().slice(0, 500);
};


const toItemView = (item) => {
  const remainingQuantity = getRemainingQuantity(item);
  const returnableQuantity = getReturnableQuantity(item);

  let remainingTotal = 0;

  if (item.quantity > 0) {
    remainingTotal =
      (item.itemTotal / item.quantity) * remainingQuantity;
  }

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

    cancelledQuantity: item.cancelledQuantity || 0,
    remainingQuantity,
    remainingTotal: round2(remainingTotal),

    returnRequestedQuantity: item.returnRequestedQuantity || 0,
    returnedQuantity: item.returnedQuantity || 0,

  
    cancelReason: item.cancelReason,
    cancelledAt: item.cancelledAt,

   
    returnReason: item.returnReason,
    returnDescription: item.returnDescription,
    returnRequestedAt: item.returnRequestedAt,
    returnRejectReason: item.returnRejectReason || null,
    returnRejectedAt: item.returnRejectedAt || null,

    statusHistory: item.statusHistory,


    canCancel:
      item.status === ITEM_STATUS.PENDING &&
      remainingQuantity > 0,

    maxCancelQuantity:
      item.status === ITEM_STATUS.PENDING
        ? remainingQuantity
        : 0,

    canReturn: returnableQuantity > 0,
    maxReturnQuantity: returnableQuantity,
  };
};



const toOrderView = (order, items) => {
  // Nothing of an unpaid order can be cancelled or returned item by item: its payment is retried or cancelled instead
  const unpaidOnline = isUnpaidOnline(order);
  // Once any item has shipped, the whole order can no longer be cancelled (items still processing keep their own Cancel item)
  const shipped = hasLeftProcessing(items);
  const itemViews = items.map((item) => {
    const view = toItemView(item);
    return unpaidOnline ? { ...view, canCancel: false, maxCancelQuantity: 0, canReturn: false, maxReturnQuantity: 0 } : view;
  });

  const canCancel = itemViews.some((item) => item.canCancel);
  const canReturn = itemViews.some((item) => item.canReturn);

  return {
    id: String(order._id),
    orderNumber: order.orderNumber,

    status: order.status,
    // payment_failed | payment_pending | the normal order status (what the customer sees as the badge)
    displayStatus: getDisplayStatus(order),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    payment: {
      gateway: order.payment?.gateway || null,
      paymentId: order.payment?.paymentId || null,
      paidAt: order.payment?.paidAt || null,
      refundedAmount: order.payment?.refundedInr || 0,
      failureReason: order.payment?.failureReason || null,
      refundError: order.payment?.refundError || null,
    },
    // Retry state of an unpaid online order (attempts, 30 minute hold, cool-down before the final attempt)
    paymentFlow: isUnpaidOnline(order) ? describeRetryState(order) : null,

    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,

    shippingAddress: order.shippingAddress,
    couponCode: order.couponCode || null,

    pricing: {
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      couponDiscount: order.couponDiscount || 0,
      referralDiscount: order.referralDiscount || 0,
      taxTotal: order.taxTotal,
      shippingFee: order.shippingFee,
      totalAmount: order.totalAmount,
    },

    items: itemViews,
    itemCount: itemViews.length,

    // An order that is not paid yet is not cancelled like a normal order: its payment is retried or cancelled instead
    canCancel:
      order.status === ORDER_STATUS.PENDING && canCancel && !shipped && !isUnpaidOnline(order),

    // Each item is delivered on its own, so a delivered pair can be returned
    // even while another pair of the same order is still on its way.
    canReturn: canReturn && !isUnpaidOnline(order),

    canDownloadInvoice: order.status !== ORDER_STATUS.CANCELLED && !isUnpaidOnline(order),
  };
};


// The order status follows its items (see deriveOrderStatus in utils/orderHelpers.js).
// Call this after ANY item moved: the admin updated an item, or an item was cancelled.
// When the order becomes delivered it also does what must happen at that moment:
// the delivered date, Cash on Delivery marked as paid, and the referral reward.
// (An order whose items are ALL cancelled is closed by refreshOrderAfterCancel, not here.)
const syncOrderStatus = async (orderRef) => {
  const order = await Order.findById(orderRef._id || orderRef);
  if (!order || order.status === ORDER_STATUS.CANCELLED) return order;

  const items = await OrderItem.find({ orderId: order._id });
  const next = deriveOrderStatus(items);

  // Nothing changed, or all items are cancelled (handled by the cancel flow). Never move backwards.
  if (next === order.status || next === ORDER_STATUS.CANCELLED) return order;
  if (STATUS_FLOW.indexOf(next) < STATUS_FLOW.indexOf(order.status)) return order;

  const set = { status: next };

  if (next === ORDER_STATUS.DELIVERED) {
    set.deliveredAt = new Date();

    // Cash on Delivery: the cash is collected once everything has been handed over
    if (order.paymentMethod === PAYMENT_METHODS.COD && order.paymentStatus === PAYMENT_STATUS.PENDING) {
      const refunded = round2(order.payment?.refundedInr || 0);
      set.paymentStatus =
        refunded > 0 && refunded >= round2(order.totalAmount) ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PAID;
    }
  }

  // Only one request can win this change, so the side effects below happen once
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status },
    { $set: set },
    { returnDocument: 'after' }
  );
  if (!claimed) return Order.findById(order._id);

  // A referred friend's first order has arrived: pay the person who referred them.
  // (A failure here must never undo the delivery, so it is only logged.)
  if (next === ORDER_STATUS.DELIVERED) {
    try {
      await referralService.rewardReferrerForOrder(claimed);
    } catch (err) {
      console.error('Referral reward failed for order', claimed.orderNumber, err.message);
    }
  }

  return claimed;
};


const refreshOrderAfterCancel = async (order, reason) => {
  const items = await OrderItem.find({
    orderId: order._id,
  });

  const activeItems = items.filter((item) => {
    return getRemainingQuantity(item) > 0;
  });


  if (activeItems.length === 0) {
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();

    if (reason) {
      order.cancelReason = reason;
    }

    await order.save();

    await releaseCoupon(order.couponId);

    // Paid (Razorpay / wallet): send everything that was not refunded yet to the wallet (COD / unpaid: does nothing)
    await refundOrder(order, null, { reason: 'cancel' });

    return;
  }

  const totalBefore = order.totalAmount;

  const lines = [];
  let couponDiscount = 0;
  let referralDiscount = 0;

  for (const item of activeItems) {
    const remainingQuantity = getRemainingQuantity(item);


    const remainingRatio = remainingQuantity / item.quantity;

    const lineSubtotal = item.price * remainingQuantity;

    const lineTotal = round2(item.itemTotal * remainingRatio);

    const lineDiscount = round2(lineSubtotal - lineTotal);

    const taxAmount = round2(
      (item.taxAmount || 0) * remainingRatio
    );

    const itemCouponDiscount = round2(
      (item.couponShare || 0) * remainingRatio
    );

    couponDiscount += itemCouponDiscount;

    // the referral offer is shared over the items the same way a coupon is
    referralDiscount += round2((item.referralShare || 0) * remainingRatio);

    lines.push({
      lineSubtotal,
      lineDiscount,
      taxAmount,
    });
  }


  const totals = calculateTotals(
    lines,
    order.shippingFee,
    round2(couponDiscount),
    round2(referralDiscount)
  );

  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.couponDiscount = totals.couponDiscount;
  order.referralDiscount = totals.referralDiscount;
  order.taxTotal = totals.taxTotal;
  order.totalAmount = totals.totalAmount;

  await order.save();

  // Paid (Razorpay / wallet): refund the part of the total that was just cancelled to the wallet
  await refundOrder(order, round2(totalBefore - totals.totalAmount), { reason: 'cancel' });

  // The cancelled item may have been the one holding the order back (e.g. the only pair still packing)
  await syncOrderStatus(order._id);
};


const cancelOneItem = async (item, quantity, reason) => {
  const now = new Date();

  const cancelledQuantity = {
    $ifNull: ['$cancelledQuantity', 0],
  };

  const cancelledItem = await OrderItem.findOneAndUpdate(
    {
      _id: item._id,
      status: ITEM_STATUS.PENDING,

      $expr: {
        $lte: [
          {
            $add: [cancelledQuantity, quantity],
          },
          '$quantity',
        ],
      },
    },

    [
 
      {
        $set: {
          cancelledQuantity: {
            $add: [cancelledQuantity, quantity],
          },

          cancelReason: reason,
          cancelledAt: now,
        },
      },

   
      {
        $set: {
          status: {
            $cond: [
              {
                $gte: ['$cancelledQuantity', '$quantity'],
              },
              ITEM_STATUS.CANCELLED,
              '$status',
            ],
          },

          statusHistory: {
            $concatArrays: [
              {
                $ifNull: ['$statusHistory', []],
              },

              [
                {
                  status: {
                    $cond: [
                      {
                        $gte: ['$cancelledQuantity', '$quantity'],
                      },
                      ITEM_STATUS.CANCELLED,
                      '$status',
                    ],
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

    {
      new: true,
      updatePipeline: true,
    }
  );



  if (!cancelledItem) {
    return false;
  }


  await restoreStock(item.variantId, item.size, quantity);

  return true;
};


const requestItemReturn = async (item, quantity, reason, description) => {
  const now = new Date();


  const updatedItem = await OrderItem.findOneAndUpdate(
    {
      _id: item._id,
      status: ITEM_STATUS.DELIVERED,
    },

    {
      $set: {
        status: ITEM_STATUS.RETURN_REQUESTED,

        returnRequestedQuantity: quantity,
        returnReason: reason,
        returnDescription: description,
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

    {
      new: true,
    }
  );

  return Boolean(updatedItem);
};

const getMyOrders = async (
  userId,
  { search, status, page, limit } = {}
) => {

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  const limitNum = Math.min(
    Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const filter = {
    userId,
    // Online orders that were never paid are shown too (as "Payment pending" while the customer can still
    // pay, and as "Payment failed" once the 4 attempts or the 30 minutes are used up). Only an online order
    // that was dropped before any payment was even tried stays hidden.
    $nor: [
      {
        ...unpaidOnlineFilter(),
        status: { $ne: ORDER_STATUS.PENDING },
        'payment.attemptHistory.0': { $exists: false },
        'payment.closedReason': { $nin: ['expired', 'exhausted'] },
      },
    ],
  };


  if (status && Object.values(ORDER_STATUS).includes(status)) {
    filter.status = status;
  }

  const searchText = search ? String(search).trim() : '';

  if (searchText) {
    const searchRegex = new RegExp(escapeRegex(searchText), 'i');

    const matchingItems = await OrderItem.find({
      name: searchRegex,
    }).select('orderId');

    const matchingOrderIds = matchingItems.map((item) => {
      return item.orderId;
    });

    filter.$or = [
      {
        orderNumber: searchRegex,
      },
      {
        _id: {
          $in: matchingOrderIds,
        },
      },
    ];
  }

  const totalItems = await Order.countDocuments(filter);

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const orderIds = orders.map((order) => {
    return order._id;
  });

  const items = await OrderItem.find({
    orderId: {
      $in: orderIds,
    },
  });

  const orderViews = orders.map((order) => {
    const orderItems = items.filter((item) => {
      return String(item.orderId) === String(order._id);
    });

    return toOrderView(order, orderItems);
  });

  return {
    orders: orderViews,

    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
    },
  };
};

const getMyOrder = async (userId, orderRef) => {

  const order = await findUserOrder(userId, orderRef);

  const items = await OrderItem.find({
    orderId: order._id,
  });

  return toOrderView(order, items);
};

const cancelOrder = async (userId, orderRef, { reason } = {}) => {
  const cleanReason = getCancelReason(reason);

  const order = await findUserOrder(userId, orderRef);
  assertNotUnpaidOnline(order);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  if (order.status === ORDER_STATUS.DELIVERED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_DELIVERED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  if (order.status !== ORDER_STATUS.PENDING) {
    throw createError(
      MESSAGES.ORDER.CANNOT_CANCEL_AFTER_SHIPPED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  const allItems = await OrderItem.find({ orderId: order._id });

  // The order status follows the slowest item, so also look at every item:
  // if any of them has already shipped, the order can no longer be cancelled.
  if (hasLeftProcessing(allItems)) {
    throw createError(
      MESSAGES.ORDER.CANNOT_CANCEL_ORDER_ALREADY_SHIPPED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  const items = allItems.filter((item) => item.status === ITEM_STATUS.PENDING);

  if (items.length === 0) {
    throw createError(
      MESSAGES.ORDER.ALL_ITEMS_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  for (const item of items) {
    const quantity = getRemainingQuantity(item);

    if (quantity > 0) {
      await cancelOneItem(item, quantity, cleanReason);
    }
  }

  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

const cancelOrderItem = async (
  userId,
  orderRef,
  itemId,
  { quantity, reason } = {}
) => {

  if (!isObjectId(itemId)) {
    throw createError(
      MESSAGES.ORDER.INVALID_ITEM_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ITEM_ID
    );
  }

  const cleanQuantity = getValidQuantity(quantity);
  const cleanReason = getCancelReason(reason);


  const order = await findUserOrder(userId, orderRef);
  assertNotUnpaidOnline(order);


  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

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

  if (item.status === ITEM_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.ITEM_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  if (item.status !== ITEM_STATUS.PENDING) {
    throw createError(
      MESSAGES.ORDER.CANNOT_CANCEL_ITEM_AFTER_SHIPPED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  const remainingQuantity = getRemainingQuantity(item);

  if (cleanQuantity > remainingQuantity) {
    throw createError(
      MESSAGES.ORDER.CANCEL_QUANTITY_EXCEEDS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_QUANTITY
    );
  }

  const cancelled = await cancelOneItem(
    item,
    cleanQuantity,
    cleanReason
  );

  if (!cancelled) {
    throw createError(
      MESSAGES.ORDER.CANCEL_QUANTITY_EXCEEDS,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }

  await refreshOrderAfterCancel(order, cleanReason);

  return getMyOrder(userId, order._id);
};

const returnOrder = async (
  userId,
  orderRef,
  { reason, description, itemIds } = {}
) => {
  const cleanReason = getReturnReason(reason);
  const cleanDescription = getReturnDescription(description);

  const order = await findUserOrder(userId, orderRef);
  assertNotUnpaidOnline(order);

  const filter = {
    orderId: order._id,
    status: ITEM_STATUS.DELIVERED,
  };


  if (Array.isArray(itemIds) && itemIds.length > 0) {
    const validItemIds = itemIds.every((id) => isObjectId(id));

    if (!validItemIds) {
      throw createError(
        MESSAGES.ORDER.INVALID_ITEM_ID,
        STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_ITEM_ID
      );
    }

    filter._id = {
      $in: itemIds,
    };
  }


  const items = await OrderItem.find(filter);

  // Returns work per item: at least one item must already be delivered
  if (items.length === 0) {
    throw createError(
      MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  let requestedCount = 0;



  for (const item of items) {
    const quantity = getReturnableQuantity(item);

    if (quantity > 0) {
      const requested = await requestItemReturn(
        item,
        quantity,
        cleanReason,
        cleanDescription
      );

      if (requested) {
        requestedCount += 1;
      }
    }
  }

  if (requestedCount === 0) {
    throw createError(
      MESSAGES.ORDER.NO_RETURNABLE_ITEMS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  return getMyOrder(userId, order._id);
};


const returnOrderItem = async (
  userId,
  orderRef,
  itemId,
  { quantity, reason, description } = {}
) => {

  if (!isObjectId(itemId)) {
    throw createError(
      MESSAGES.ORDER.INVALID_ITEM_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ITEM_ID
    );
  }

  const cleanQuantity = getValidQuantity(quantity);
  const cleanReason = getReturnReason(reason);
  const cleanDescription = getReturnDescription(description);

  const order = await findUserOrder(userId, orderRef);
  assertNotUnpaidOnline(order);

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

  // The item itself must be delivered (the rest of the order may still be on its way)
  if (STATUS_FLOW.includes(item.status) && item.status !== ITEM_STATUS.DELIVERED) {
    throw createError(
      MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  const maxReturnQuantity = getReturnableQuantity(item);

  if (maxReturnQuantity === 0) {
    throw createError(
      MESSAGES.ORDER.NO_RETURNABLE_ITEMS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  if (cleanQuantity > maxReturnQuantity) {
    throw createError(
      MESSAGES.ORDER.RETURN_QUANTITY_EXCEEDS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_QUANTITY
    );
  }

  const requested = await requestItemReturn(
    item,
    cleanQuantity,
    cleanReason,
    cleanDescription
  );

  if (!requested) {
    throw createError(
      MESSAGES.ORDER.NO_RETURNABLE_ITEMS,
      STATUS.CONFLICT,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }

  return getMyOrder(userId, order._id);
};


const getInvoiceData = async (userId, orderRef) => {

  const order = await findUserOrder(userId, orderRef);
  assertNotUnpaidOnline(order);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER,
      STATUS.BAD_REQUEST
    );
  }

  const items = await OrderItem.find({
    orderId: order._id,
    status: {
      $ne: ITEM_STATUS.CANCELLED,
    },
  });


  const invoiceItems = items.map((item) => {
    const remainingQuantity = getRemainingQuantity(item);

    const remainingRatio =
      item.quantity > 0
        ? remainingQuantity / item.quantity
        : 0;

    const remainingTotal = round2(
      item.itemTotal * remainingRatio
    );

    const remainingTax = round2(
      (item.taxAmount || 0) * remainingRatio
    );

    return {
      ...item.toObject(),

      quantity: remainingQuantity,
      itemTotal: remainingTotal,
      taxAmount: remainingTax,
    };
  });

  return {
    order,
    items: invoiceItems,
  };
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
  syncOrderStatus,
  cancelOneItem,
};
