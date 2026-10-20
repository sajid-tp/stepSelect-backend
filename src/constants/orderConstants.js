// src/constants/orderConstants.js
// Everything about order statuses, reasons and pricing rules in one place.

// Order and item statuses (what the admin can set)
const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  // A delivered order moves here while a return is open / finished (kept in sync from its items)
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
});

// Item-only status: admin rejected the return
const ITEM_STATUS = Object.freeze({
  ...ORDER_STATUS,
  RETURN_REJECTED: 'return_rejected',
});

// Orders in these states can still have items returned
const RETURNABLE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.RETURN_REQUESTED,
  ORDER_STATUS.RETURNED,
]);

// Admin can only move forward in this order (cancel is handled separately)
const STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

// What the API shows to the client (matches the Postman collection).
// Stored value `pending` is shown as `placed` to customers and `processing` to admins.
// Existing database records are NOT changed, only the names used in requests / responses.
const PUBLIC_STATUS = Object.freeze({
  user: { [ORDER_STATUS.PENDING]: 'placed' },
  admin: { [ORDER_STATUS.PENDING]: 'processing' },
});

// Names a client may send (filters / admin status updates) -> stored value
const STATUS_ALIASES = Object.freeze({
  placed: ORDER_STATUS.PENDING,
  processing: ORDER_STATUS.PENDING,
});

const toPublicStatus = (status, audience = 'user') =>
  (PUBLIC_STATUS[audience] && PUBLIC_STATUS[audience][status]) || status;

const toStoredStatus = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return STATUS_ALIASES[v] || v;
};

const PAYMENT_METHODS = Object.freeze({ COD: 'COD' });
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

// Quick-pick lists for the dropdowns (GET /orders/reasons).
// The API also accepts free text, because the Postman contract says "reason selected/entered by the user".
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
  'Not as described',
  'Other',
];

const MAX_REASON_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SHIPPING_TEXT_LENGTH = 100;   // carrier / trackingId

// Pricing rules. Change these numbers to change checkout everywhere.
const PRICING = Object.freeze({
  TAX_PERCENT: 0,            // taxes are optional in the task: 0 = no tax line. Try 5 for 5% GST
  SHIPPING_FEE: 0,           // flat shipping fee
  FREE_SHIPPING_ABOVE: 0,    // shipping is free when the amount after discount reaches this
});

// Delivery promise shown on the order success / details screens
const ESTIMATED_DELIVERY_DAYS = 5;

// A delivered order can be returned for this many days
const RETURN_WINDOW_DAYS = 7;

const LOW_STOCK_LIMIT = 5;

module.exports = {
  ORDER_STATUS,
  ITEM_STATUS,
  STATUS_FLOW,
  RETURNABLE_ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  CANCEL_REASONS,
  RETURN_REASONS,
  PRICING,
  PUBLIC_STATUS,
  toPublicStatus,
  toStoredStatus,
  MAX_REASON_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_SHIPPING_TEXT_LENGTH,
  ESTIMATED_DELIVERY_DAYS,
  RETURN_WINDOW_DAYS,
  LOW_STOCK_LIMIT,
};
