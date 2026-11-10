// src/constants/orderConstants.js
// Everything about order statuses, reasons and pricing rules in one place.

// Order and item statuses (what the admin can set)
const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

// Extra item-only statuses used by the return flow
const ITEM_STATUS = Object.freeze({
  ...ORDER_STATUS,
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  RETURN_REJECTED: 'return_rejected',
});

// The delivery stages in order (used to work out how far an item has travelled)
const STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// THE status rules: from each status, the only statuses the admin may move to next.
//   pending          -> shipped, or cancelled (cancel is only possible before shipping)
//   shipped          -> out_for_delivery, or straight to delivered ("out for delivery" is optional)
//   out_for_delivery -> delivered
//   delivered / cancelled -> nothing (final; after delivery the customer may ask for a return instead)
// No skipping ahead (pending -> delivered) and no going back. The server checks every change against
// this table and sends the allowed ones to the admin page, so the dropdown never offers anything else.
const STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
});

const PAYMENT_METHODS = Object.freeze({ COD: 'COD', RAZORPAY: 'RAZORPAY', WALLET: 'WALLET' });
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

// An online order whose payment has not been completed (yet). These hold stock for a short time,
// but they are not real orders: they never show in order lists and the admin cannot ship them.
// (a function, because Mongoose changes the filter objects it is given while it runs a query)
const unpaidOnlineFilter = () => ({
  paymentMethod: { $ne: PAYMENT_METHODS.COD },
  paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED] },
});

const CANCEL_REASONS = [
  'Changed my mind',
  'Ordered by mistake',
  'Found a better price',
  'Delivery is taking too long',
  'Other',
];

const RETURN_REASONS = [
  'Wrong size',
  'Damaged product',
  'Defective product',
  'Wrong item received',
  'Quality not as expected',
  'Other',
];

// Return reasons that mean the product itself is damaged / faulty. Returned units with one of these
// reasons are NEVER added back to stock automatically (they cannot be sold again as new).
// Every other reason (wrong size, wrong item, ...) is checked by the admin first - see handleReturn.
const DAMAGE_RETURN_REASONS = ['Damaged product', 'Defective product'];

const isDamageReturnReason = (reason) =>
  DAMAGE_RETURN_REASONS.some((r) => r.toLowerCase() === String(reason || '').trim().toLowerCase());

// Pricing rules. Change these numbers to change checkout everywhere.
const PRICING = Object.freeze({
  TAX_PERCENT: 0,            // taxes are optional in the task: 0 = no tax line. Try 5 for 5% GST
  SHIPPING_FEE: 0,           // flat shipping fee
  FREE_SHIPPING_ABOVE: 0,    // shipping is free when the amount after discount reaches this
});

// Business limits for one order. Change these numbers to change the rules everywhere (cart, checkout, payment).
//   MAX_QUANTITY_PER_VARIANT  most of the same variant + size one customer can have in the cart
// There is no limit on the number of items, on the order value, or on Cash on Delivery.
const ORDER_LIMITS = Object.freeze({
  MAX_QUANTITY_PER_VARIANT: 5,
});

const LOW_STOCK_LIMIT = 5;

module.exports = {
  ORDER_STATUS,
  ITEM_STATUS,
  STATUS_FLOW,
  STATUS_TRANSITIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  unpaidOnlineFilter,
  CANCEL_REASONS,
  RETURN_REASONS,
  DAMAGE_RETURN_REASONS,
  isDamageReturnReason,
  PRICING,
  ORDER_LIMITS,
  LOW_STOCK_LIMIT,
};
