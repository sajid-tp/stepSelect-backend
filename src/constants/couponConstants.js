// src/constants/couponConstants.js
// Coupon management policy: limits for every admin-editable coupon field.
// The admin coupon form (client/src/pages/admin/CouponForm.jsx) uses the same numbers - change both together.

const COUPON_LIMITS = Object.freeze({
  // Coupon code length (characters)
  CODE_MIN_LENGTH: 3,
  CODE_MAX_LENGTH: 20,

  // Percentage coupons take off a WHOLE number of percent between these values
  MIN_PERCENT: 1,
  MAX_PERCENT: 90,

  // Fixed (flat) discount amount, in rupees
  MIN_FLAT_DISCOUNT: 1,
  MAX_FLAT_DISCOUNT: 25000,

  // Maximum discount cap (percentage coupons only), in rupees - no upper limit
  MIN_DISCOUNT_CAP: 1,

  // Minimum cart value needed to use a coupon, in rupees - no upper limit
  MIN_PURCHASE_MIN: 0,

  // Total redemptions across all customers (empty = unlimited) - no upper limit
  MIN_REDEMPTION_LIMIT: 1,

  // Redemptions allowed per customer
  MIN_USES_PER_CUSTOMER: 1,
  MAX_USES_PER_CUSTOMER: 5,

  // Description length (characters)
  DESCRIPTION_MAX_LENGTH: 500,
});

// Letters, numbers, hyphens and underscores only (codes are stored upper-case)
const COUPON_CODE_REGEX = /^[A-Z0-9_-]+$/;

module.exports = { COUPON_LIMITS, COUPON_CODE_REGEX };
