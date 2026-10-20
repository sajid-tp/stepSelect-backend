// src/utils/orderViews.js
// How an order / order item looks in API responses. Shared by the user and admin services,
// so both sides always show the same fields (matches the STEP SELECT Postman collection).
const {
  ORDER_STATUS,
  ITEM_STATUS,
  RETURNABLE_ORDER_STATUSES,
  toPublicStatus,
} = require('../constants/orderConstants');
const { estimatedDeliveryDate } = require('./orderHelpers');

const asId = (value) => (value === undefined || value === null ? null : String(value));

// Readable "Size 9 · Black" label
const variantLabel = (item) => [`Size ${item.size}`, item.color].filter(Boolean).join(' \u00b7 ');

const toHistoryView = (history = [], audience) =>
  history.map((h) => ({
    status: toPublicStatus(h.status, audience),
    note: h.note || '',
    updatedAt: h.updatedAt,
  }));

const toItemView = (item, audience = 'user') => ({
  id: asId(item._id),                 // kept for older clients
  orderItemId: asId(item._id),
  productId: asId(item.productId),
  variantId: asId(item.variantId),
  name: item.name,
  color: item.color,
  size: item.size,
  variant: variantLabel(item),
  image: item.image,
  price: item.price,                  // original unit price
  discountPercent: item.discountPercent,
  finalPrice: item.finalPrice,        // unit price after discount
  quantity: item.quantity,
  itemTotal: item.itemTotal,
  status: toPublicStatus(item.status, audience),
  cancelReason: item.cancelReason,
  cancelledAt: item.cancelledAt,
  returnReason: item.returnReason,
  returnDescription: item.returnDescription,
  returnRequestedAt: item.returnRequestedAt,
  statusHistory: toHistoryView(item.statusHistory, audience),
  canCancel: item.status === ITEM_STATUS.PENDING,
  canReturn: item.status === ITEM_STATUS.DELIVERED,
});

// Timeline for the "tracking" block on the order details screen.
// Built from what really happened (item status history + order dates), oldest first.
const TRACK_STAGES = [
  [ITEM_STATUS.SHIPPED, 'Shipped'],
  [ITEM_STATUS.OUT_FOR_DELIVERY, 'Out for Delivery'],
  [ITEM_STATUS.DELIVERED, 'Delivered'],
  [ITEM_STATUS.RETURN_REQUESTED, 'Return Requested'],
  [ITEM_STATUS.RETURNED, 'Returned'],
];

const buildTracking = (order, items) => {
  const tracking = [{ stage: 'Order Placed', timestamp: order.createdAt }];

  for (const [status, stage] of TRACK_STAGES) {
    const times = items
      .flatMap((i) => i.statusHistory || [])
      .filter((h) => h.status === status && h.updatedAt)
      .map((h) => new Date(h.updatedAt).getTime());
    let timestamp = times.length ? new Date(Math.min(...times)) : null;
    if (status === ITEM_STATUS.DELIVERED && order.deliveredAt) timestamp = order.deliveredAt;
    if (timestamp) tracking.push({ stage, timestamp });
  }

  if (order.status === ORDER_STATUS.CANCELLED || order.cancelledAt) {
    tracking.push({ stage: 'Cancelled', timestamp: order.cancelledAt || order.updatedAt, note: order.cancelReason || '' });
  }

  return tracking.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// Full order (order details screen, admin edit screen)
const toOrderView = (order, items, audience = 'user') => {
  const itemViews = items.map((i) => toItemView(i, audience));
  const estimated = estimatedDeliveryDate(order);

  return {
    id: asId(order._id),
    orderNumber: order.orderNumber,
    status: toPublicStatus(order.status, audience),
    placedAt: order.createdAt,
    createdAt: order.createdAt,
    estimatedDate: estimated,
    estimatedDelivery: estimated,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    shippingAddress: order.shippingAddress,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    carrier: order.carrier || '',
    trackingId: order.trackingId || '',
    items: itemViews,
    itemCount: itemViews.length,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    shippingFee: order.shippingFee,
    grandTotal: order.totalAmount,
    total: order.totalAmount,
    pricing: {
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      shippingFee: order.shippingFee,
      totalAmount: order.totalAmount,
    },
    tracking: buildTracking(order, items),
    canCancel: order.status === ORDER_STATUS.PENDING && itemViews.some((i) => i.canCancel),
    canReturn: RETURNABLE_ORDER_STATUSES.includes(order.status) && itemViews.some((i) => i.canReturn),
    canDownloadInvoice: order.status !== ORDER_STATUS.CANCELLED,
  };
};

// One row of "My orders" (Order History page): small on purpose, open the order for the rest
const toOrderListView = (order, items, audience = 'user') => {
  const live = items.map((i) => ({
    id: asId(i._id),
    orderItemId: asId(i._id),
    productId: asId(i.productId),
    variantId: asId(i.variantId),
    name: i.name,
    color: i.color,
    size: i.size,
    image: i.image,
    quantity: i.quantity,
    price: i.price,
    finalPrice: i.finalPrice,
    itemTotal: i.itemTotal,
    status: toPublicStatus(i.status, audience),
  }));

  return {
    id: asId(order._id),
    orderNumber: order.orderNumber,
    status: toPublicStatus(order.status, audience),
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    placedAt: order.createdAt,
    itemCount: live.length,
    image: live.length ? live[0].image : null,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    items: live,
  };
};

module.exports = { toItemView, toOrderView, toOrderListView, buildTracking, variantLabel };
