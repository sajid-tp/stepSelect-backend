// Business rules for coupons. Change the numbers here (and MAX_DISCOUNT_PERCENT in
// client/src/pages/admin/CouponForm.jsx) if the shop wants different limits.
module.exports = Object.freeze({
  // No coupon may take off more than this share of the cart (so an order is never free).
  MAX_DISCOUNT_PERCENT: 90,
  // Smallest percentage a percentage coupon can give.
  MIN_PERCENT: 1,
  CODE_MIN: 3,
  CODE_MAX: 40,
  CODE_REGEX: /^[A-Z0-9_-]+$/,
});
