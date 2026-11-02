// src/constants/offerConstants.js
// Everything about product / category offers and the referral programme in one place.

const OFFER_TYPE = Object.freeze({ PRODUCT: 'product', CATEGORY: 'category' });

// An offer can take off between these percentages (whole numbers)
const OFFER_LIMITS = Object.freeze({ MIN_PERCENT: 1, MAX_PERCENT: 90 });

// Starting values of the referral programme. The admin changes them on the Offers page
// (Referral Offers tab); these only apply until the first save.
//   referredDiscount : rupees off the FRIEND's first order
//   minOrderAmount   : the first order must be worth at least this much (after product / category offers)
//   referrerReward   : rupees the REFERRER gets in their wallet once that order is delivered
const REFERRAL_DEFAULTS = Object.freeze({
  isActive: true,
  referredDiscount: 300,
  minOrderAmount: 2000,
  referrerReward: 300,
});

module.exports = { OFFER_TYPE, OFFER_LIMITS, REFERRAL_DEFAULTS };
