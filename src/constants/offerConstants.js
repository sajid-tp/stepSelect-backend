const OFFER_TYPE = Object.freeze({ PRODUCT: 'product', CATEGORY: 'category' });

const OFFER_LIMITS = Object.freeze({ MIN_PERCENT: 1, MAX_PERCENT: 90 });

const REFERRAL_DEFAULTS = Object.freeze({
  isActive: true,
  referredDiscount: 300,
  minOrderAmount: 2000,
  referrerReward: 300,
});

module.exports = { OFFER_TYPE, OFFER_LIMITS, REFERRAL_DEFAULTS };
