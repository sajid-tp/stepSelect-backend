
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


// Default pagination settings
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;


// ==================================================
// BASIC HELPER FUNCTIONS
// ==================================================

// Round a number to two decimal places
const round2 = (number) => {
  return Math.round((Number(number) || 0) * 100) / 100;
};


// Calculate the quantity that has not been cancelled
const getRemainingQuantity = (item) => {
  const cancelledQuantity = item.cancelledQuantity || 0;

  return item.quantity - cancelledQuantity;
};


// Calculate how many units can still be returned
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


// Find an order that belongs to the logged-in user
const findUserOrder = async (userId, orderRef) => {
  if (!orderRef) {
    throw createError(
      MESSAGES.ORDER.INVALID_ORDER_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ORDER_ID
    );
  }

  let order;

  // The user may provide either the MongoDB ID or the order number
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


// Validate the cancellation reason
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


// Validate the return reason
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


// Validate a requested quantity
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


// Clean the optional return description
const getReturnDescription = (description) => {
  if (!description) {
    return null;
  }

  return String(description).trim().slice(0, 500);
};


// ==================================================
// FORMAT ORDER DATA FOR THE FRONTEND
// ==================================================

// Convert one order item into a simple response object
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

    // Quantity information
    cancelledQuantity: item.cancelledQuantity || 0,
    remainingQuantity,
    remainingTotal: round2(remainingTotal),

    returnRequestedQuantity: item.returnRequestedQuantity || 0,
    returnedQuantity: item.returnedQuantity || 0,

    // Cancellation information
    cancelReason: item.cancelReason,
    cancelledAt: item.cancelledAt,

    // Return information
    returnReason: item.returnReason,
    returnDescription: item.returnDescription,
    returnRequestedAt: item.returnRequestedAt,
    returnRejectReason: item.returnRejectReason || null,
    returnRejectedAt: item.returnRejectedAt || null,

    statusHistory: item.statusHistory,

    // Actions available to the customer
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


// Convert an order and its items into the frontend response
const toOrderView = (order, items) => {
  const itemViews = items.map((item) => {
    return toItemView(item);
  });

  const canCancel = itemViews.some((item) => item.canCancel);
  const canReturn = itemViews.some((item) => item.canReturn);

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

    canCancel:
      order.status === ORDER_STATUS.PENDING && canCancel,

    canReturn:
      order.status === ORDER_STATUS.DELIVERED && canReturn,

    canDownloadInvoice: order.status !== ORDER_STATUS.CANCELLED,
  };
};


// ==================================================
// UPDATE ORDER TOTALS AFTER CANCELLATION
// ==================================================

const refreshOrderAfterCancel = async (order, reason) => {
  const items = await OrderItem.find({
    orderId: order._id,
  });

  // Keep items that still have at least one uncancelled unit
  const activeItems = items.filter((item) => {
    return getRemainingQuantity(item) > 0;
  });


  // If every item is cancelled, cancel the whole order
  if (activeItems.length === 0) {
    order.status = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();

    if (reason) {
      order.cancelReason = reason;
    }

    await order.save();

    // Restore the coupon usage because the whole order was cancelled
    await releaseCoupon(order.couponId);

    return;
  }


  // Recalculate the totals for the remaining quantities
  const lines = [];
  let couponDiscount = 0;

  for (const item of activeItems) {
    const remainingQuantity = getRemainingQuantity(item);

    // Calculate the proportion of the item that remains
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

    lines.push({
      lineSubtotal,
      lineDiscount,
      taxAmount,
    });
  }


  // Use the existing helper to calculate the final totals
  const totals = calculateTotals(
    lines,
    order.shippingFee,
    round2(couponDiscount)
  );

  order.subtotal = totals.subtotal;
  order.discountTotal = totals.discountTotal;
  order.couponDiscount = totals.couponDiscount;
  order.taxTotal = totals.taxTotal;
  order.totalAmount = totals.totalAmount;

  await order.save();
};


// ==================================================
// CANCEL A PRODUCT'S QUANTITY
// ==================================================

const cancelOneItem = async (item, quantity, reason) => {
  const now = new Date();

  // Keep this database update atomic.
  // It prevents cancelling more units than were ordered.
  // It also prevents two simultaneous requests from cancelling the same units.

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
      // First, update the cancelled quantity
      {
        $set: {
          cancelledQuantity: {
            $add: [cancelledQuantity, quantity],
          },

          cancelReason: reason,
          cancelledAt: now,
        },
      },

      // Then update the status and add to the history
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


  // If the update failed, the item could have changed
  if (!cancelledItem) {
    return false;
  }

  // Restore the cancelled units to inventory
  await restoreStock(item.variantId, item.size, quantity);

  return true;
};


// ==================================================
// REQUEST A RETURN FOR A PRODUCT
// ==================================================

const requestItemReturn = async (item, quantity, reason, description) => {
  const now = new Date();

  // Only delivered items can be returned
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


// ==================================================
// 1. GET ALL ORDERS FOR THE LOGGED-IN USER
// ==================================================

const getMyOrders = async (
  userId,
  { search, status, page, limit } = {}
) => {
  // Prepare pagination
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  const limitNum = Math.min(
    Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );


  // Start by finding orders belonging to this user
  const filter = {
    userId,
  };


  // Apply the status filter if it is valid
  if (status && Object.values(ORDER_STATUS).includes(status)) {
    filter.status = status;
  }


  // Search by order number or product name
  const searchText = search ? String(search).trim() : '';

  if (searchText) {
    const searchRegex = new RegExp(escapeRegex(searchText), 'i');

    // Find products whose names match the search
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


  // Count orders before applying pagination
  const totalItems = await Order.countDocuments(filter);


  // Fetch the orders for the requested page
  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);


  // Fetch the items belonging to these orders
  const orderIds = orders.map((order) => {
    return order._id;
  });

  const items = await OrderItem.find({
    orderId: {
      $in: orderIds,
    },
  });


  // Attach the correct items to each order
  const orderViews = orders.map((order) => {
    const orderItems = items.filter((item) => {
      return String(item.orderId) === String(order._id);
    });

    return toOrderView(order, orderItems);
  });


  // Return the orders and pagination information
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


// ==================================================
// 2. GET ONE ORDER
// ==================================================

const getMyOrder = async (userId, orderRef) => {
  // Find the order and confirm that it belongs to the user
  const order = await findUserOrder(userId, orderRef);

  // Find the products in the order
  const items = await OrderItem.find({
    orderId: order._id,
  });

  // Return the order in frontend-friendly format
  return toOrderView(order, items);
};


// ==================================================
// 3. CANCEL THE WHOLE ORDER
// ==================================================

const cancelOrder = async (userId, orderRef, { reason } = {}) => {
  const cleanReason = getCancelReason(reason);

  // Find the user's order
  const order = await findUserOrder(userId, orderRef);


  // Check whether cancellation is allowed
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


  // Find all products that are still pending
  const items = await OrderItem.find({
    orderId: order._id,
    status: ITEM_STATUS.PENDING,
  });

  if (items.length === 0) {
    throw createError(
      MESSAGES.ORDER.ALL_ITEMS_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }


  // Cancel the remaining quantity of each product
  for (const item of items) {
    const quantity = getRemainingQuantity(item);

    if (quantity > 0) {
      await cancelOneItem(item, quantity, cleanReason);
    }
  }


  // Update the order's totals and status
  await refreshOrderAfterCancel(order, cleanReason);

  // Return the updated order
  return getMyOrder(userId, order._id);
};


// ==================================================
// 4. CANCEL A SINGLE PRODUCT
// ==================================================

const cancelOrderItem = async (
  userId,
  orderRef,
  itemId,
  { quantity, reason } = {}
) => {
  // Validate the product's order-item ID
  if (!isObjectId(itemId)) {
    throw createError(
      MESSAGES.ORDER.INVALID_ITEM_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_ITEM_ID
    );
  }

  const cleanQuantity = getValidQuantity(quantity);
  const cleanReason = getCancelReason(reason);

  // Find the order
  const order = await findUserOrder(userId, orderRef);


  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.ORDER_ALREADY_CANCELLED,
      STATUS.CONFLICT,
      ERROR_CODES.CANCEL_NOT_ALLOWED
    );
  }


  // Find the requested product inside this order
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


  // Check the product's current status
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


  // Make sure the customer is not cancelling too many units
  const remainingQuantity = getRemainingQuantity(item);

  if (cleanQuantity > remainingQuantity) {
    throw createError(
      MESSAGES.ORDER.CANCEL_QUANTITY_EXCEEDS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_QUANTITY
    );
  }


  // Perform the cancellation
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


  // Recalculate the order's price
  await refreshOrderAfterCancel(order, cleanReason);

  // Return the updated order
  return getMyOrder(userId, order._id);
};


// ==================================================
// 5. RETURN PRODUCTS FROM AN ORDER
// ==================================================

const returnOrder = async (
  userId,
  orderRef,
  { reason, description, itemIds } = {}
) => {
  const cleanReason = getReturnReason(reason);
  const cleanDescription = getReturnDescription(description);

  // Find the order
  const order = await findUserOrder(userId, orderRef);


  // Returns are allowed only after delivery
  if (order.status !== ORDER_STATUS.DELIVERED) {
    throw createError(
      MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }


  // Find delivered products in the order
  const filter = {
    orderId: order._id,
    status: ITEM_STATUS.DELIVERED,
  };


  // If specific products were selected, return only those products
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

  let requestedCount = 0;


  // Request returns for the selected products
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


  // Make sure at least one product was eligible for return
  if (requestedCount === 0) {
    throw createError(
      MESSAGES.ORDER.NO_RETURNABLE_ITEMS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }


  // Return the updated order
  return getMyOrder(userId, order._id);
};


// ==================================================
// 6. RETURN A SPECIFIC PRODUCT
// ==================================================

const returnOrderItem = async (
  userId,
  orderRef,
  itemId,
  { quantity, reason, description } = {}
) => {
  // Validate the order-item ID
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


  // Find the order
  const order = await findUserOrder(userId, orderRef);


  // The order must have been delivered
  if (order.status !== ORDER_STATUS.DELIVERED) {
    throw createError(
      MESSAGES.ORDER.RETURN_ONLY_AFTER_DELIVERY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.RETURN_NOT_ALLOWED
    );
  }


  // Find the selected product in this order
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


  // Check how many units can still be returned
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


  // Create the return request
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


  // Return the updated order
  return getMyOrder(userId, order._id);
};


// ==================================================
// 7. GET DATA REQUIRED FOR THE INVOICE
// ==================================================

const getInvoiceData = async (userId, orderRef) => {
  // Find the order and verify ownership
  const order = await findUserOrder(userId, orderRef);


  // Cancelled orders cannot have an invoice
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw createError(
      MESSAGES.ORDER.INVOICE_NOT_AVAILABLE_FOR_CANCELLED_ORDER,
      STATUS.BAD_REQUEST
    );
  }


  // Find all items that have not been completely cancelled
  const items = await OrderItem.find({
    orderId: order._id,
    status: {
      $ne: ITEM_STATUS.CANCELLED,
    },
  });


  // Calculate the quantity and price remaining after cancellations
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


  // Return the order and its invoice items
  return {
    order,
    items: invoiceItems,
  };
};


// ==================================================
// EXPORT SERVICE FUNCTIONS
// ==================================================

module.exports = {
  getMyOrders,
  getMyOrder,

  cancelOrder,
  cancelOrderItem,

  returnOrder,
  returnOrderItem,

  getInvoiceData,

  // Exported for use elsewhere if required
  toOrderView,
  refreshOrderAfterCancel,
  cancelOneItem,
};
