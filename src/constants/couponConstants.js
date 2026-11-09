
const COUPON_LIMITS = Object.freeze({
  // Discount rules
  MAX_PERCENT: 90,
  MIN_PERCENT: 1,

  // Coupon code rules
  CODE_MIN_LENGTH: 3,
  CODE_MAX_LENGTH: 40,
  CODE_REGEX: /^[A-Z0-9_-]+$/,

  // Description
  DESCRIPTION_MAX_LENGTH: 200,

  // Discount amount
  MAX_FLAT_DISCOUNT: 1000000,
  MIN_DISCOUNT_CAP: 1,

  // Purchase amount
  MIN_PURCHASE_MIN: 0,

  // Redemption rules
  MIN_REDEMPTION_LIMIT: 1,
  MIN_USES_PER_CUSTOMER: 1,
  MAX_USES_PER_CUSTOMER: 5,
});

module.exports = { COUPON_LIMITS };
