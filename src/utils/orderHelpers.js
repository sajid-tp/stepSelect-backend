// src/utils/orderHelpers.js
// Small helpers shared by checkout, orders and admin order services.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Variant = require('../models/variants');
const { PRICING } = require('../constants/orderConstants');

const isObjectId = (id) => Boolean(id) && /^[0-9a-fA-F]{24}$/.test(String(id));

// "ORD-20261020-A3F9C2": same format every time, random part makes it unique
const generateOrderNumber = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${date}-${random}`;
};

// Make user text safe to put inside a RegExp (search boxes)
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Price after discount for ONE unit
const getFinalUnitPrice = (price, discountPercent) => {
  const p = Number(price) || 0;
  const d = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  return Math.round(p - (p * d) / 100);
};

// Money for one line. Used by the checkout summary and when the order is created,
// so the user always pays exactly what the summary showed.
const calculateLine = (price, discountPercent, quantity) => {
  const finalPrice = getFinalUnitPrice(price, discountPercent);
  const lineSubtotal = Number(price) * quantity;
  const itemTotal = finalPrice * quantity;
  return {
    finalPrice,
    lineSubtotal,
    itemTotal,
    lineDiscount: lineSubtotal - itemTotal,
    taxAmount: Math.round((itemTotal * PRICING.TAX_PERCENT) / 100),
  };
};

// Totals for a list of lines (each line from calculateLine).
// couponDiscount (optional) is the money a coupon takes off AFTER the product discounts.
// referralDiscount (optional) is the referral offer, taken off after the coupon.
const calculateTotals = (lines, shippingFeeOverride, couponDiscount = 0, referralDiscount = 0) => {
  const subtotal = lines.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const discountTotal = lines.reduce((sum, l) => sum + l.lineDiscount, 0);
  const taxTotal = lines.reduce((sum, l) => sum + l.taxAmount, 0);
  const afterDiscount = subtotal - discountTotal;

  // A coupon can never take off more than what is left to pay
  const coupon = Math.min(Math.max(Math.round(Number(couponDiscount) || 0), 0), afterDiscount);
  const afterCoupon = afterDiscount - coupon;

  // The referral offer can never take off more than what is left to pay
  const referral = Math.min(Math.max(Math.round(Number(referralDiscount) || 0), 0), afterCoupon);
  const afterReferral = afterCoupon - referral;

  let shippingFee = shippingFeeOverride;
  if (shippingFee === undefined) {
    const free = PRICING.FREE_SHIPPING_ABOVE > 0 && afterReferral >= PRICING.FREE_SHIPPING_ABOVE;
    shippingFee = free || lines.length === 0 ? 0 : PRICING.SHIPPING_FEE;
  }

  return {
    subtotal,
    discountTotal,
    couponDiscount: coupon,
    referralDiscount: referral,
    taxTotal,
    shippingFee,
    totalAmount: afterReferral + taxTotal + shippingFee,
  };
};

// How much a coupon takes off `base` (the amount after product discounts, before tax/shipping).
//   percentage -> base x value / 100, limited by maximumDiscount (null or 0 = no limit)
//   flat       -> the fixed value
// In both cases the result is a whole number and never more than `base`.
const calculateCouponDiscount = (coupon, base) => {
  const amount = Math.max(Number(base) || 0, 0);
  let discount;

  if (coupon.discountType === 'percentage') {
    discount = (amount * coupon.discountValue) / 100;
    if (coupon.maximumDiscount != null && coupon.maximumDiscount > 0) {
      discount = Math.min(discount, coupon.maximumDiscount);
    }
  } else {
    discount = coupon.discountValue;
  }

  return Math.max(Math.min(Math.round(discount), amount), 0);
};

// Split a discount (coupon or referral) over the order lines in proportion to what each line costs.
// The shares always add up to exactly couponDiscount (the last line takes the rounding leftover).
const allocateCouponShares = (lines, couponDiscount) => {
  const total = lines.reduce((sum, l) => sum + l.itemTotal, 0);
  if (!couponDiscount || total <= 0) return lines.map(() => 0);

  let given = 0;
  return lines.map((l, index) => {
    if (index === lines.length - 1) return couponDiscount - given;
    const share = Math.floor((l.itemTotal * couponDiscount) / total);
    given += share;
    return share;
  });
};

// Take stock out. Atomic: the update only matches if enough stock is still there,
// so two people buying the last pair at the same time can never both succeed.
const reduceStock = async (variantId, size, quantity) => {
  const result = await Variant.updateOne(
    { _id: variantId, sizes: { $elemMatch: { size: String(size), stock: { $gte: quantity } } } },
    { $inc: { 'sizes.$.stock': -quantity } }
  );
  return result.modifiedCount === 1;
};

// Put stock back (cancel / approved return)
const restoreStock = async (variantId, size, quantity) => {
  if (!quantity || quantity < 1) return;
  await Variant.updateOne(
    { _id: variantId, 'sizes.size': String(size) },
    { $inc: { 'sizes.$.stock': quantity } }
  );
};

// Add a line to the item's status history
const pushHistory = (item, status, note = '') => {
  item.statusHistory.push({ status, note, updatedAt: new Date() });
};

const first = (images) => {
  if (!images || images.length === 0) return null;
  const img = images[0];
  return typeof img === 'string' ? img : img.url || null;
};

module.exports = {
  isObjectId,
  generateOrderNumber,
  escapeRegex,
  getFinalUnitPrice,
  calculateLine,
  calculateTotals,
  calculateCouponDiscount,
  allocateCouponShares,
  reduceStock,
  restoreStock,
  pushHistory,
  firstImage: first,
  mongoose,
};
