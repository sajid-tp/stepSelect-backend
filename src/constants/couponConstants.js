// src/constants/couponConstants.js
// Limits for coupons. The admin coupon form (client/src/pages/admin/CouponForm.jsx) uses the same numbers.

// A percentage coupon takes off a WHOLE number of percent between these values (flat coupons are not affected)
const COUPON_LIMITS = Object.freeze({ MIN_PERCENT: 1, MAX_PERCENT: 90 });

module.exports = { COUPON_LIMITS };
