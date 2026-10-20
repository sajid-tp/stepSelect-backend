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

// Admin can only move forward in this order (cancel is handled separately)
const STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

const PAYMENT_METHODS = Object.freeze({ COD: 'COD' });
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
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

// Pricing rules. Change these numbers to change checkout everywhere.
const PRICING = Object.freeze({
  TAX_PERCENT: 0,            // taxes are optional in the task: 0 = no tax line. Try 5 for 5% GST
  SHIPPING_FEE: 0,           // flat shipping fee
  FREE_SHIPPING_ABOVE: 0,    // shipping is free when the amount after discount reaches this
});

const LOW_STOCK_LIMIT = 5;

module.exports = {
  ORDER_STATUS,
  ITEM_STATUS,
  STATUS_FLOW,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  CANCEL_REASONS,
  RETURN_REASONS,
  PRICING,
  LOW_STOCK_LIMIT,
};
