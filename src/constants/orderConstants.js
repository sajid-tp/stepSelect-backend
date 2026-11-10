const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

const ITEM_STATUS = Object.freeze({
  ...ORDER_STATUS,
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  RETURN_REJECTED: 'return_rejected',
});

const STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

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

const DAMAGE_RETURN_REASONS = ['Damaged product', 'Defective product'];

const isDamageReturnReason = (reason) =>
  DAMAGE_RETURN_REASONS.some((r) => r.toLowerCase() === String(reason || '').trim().toLowerCase());

const PRICING = Object.freeze({
  TAX_PERCENT: 0,
  SHIPPING_FEE: 0,
  FREE_SHIPPING_ABOVE: 0,
});

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
