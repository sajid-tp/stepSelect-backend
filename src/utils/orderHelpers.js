const crypto = require('crypto');
const mongoose = require('mongoose');
const Variant = require('../models/variants');
const { PRICING, ORDER_STATUS, ITEM_STATUS, STATUS_FLOW } = require('../constants/orderConstants');
const { MAX_DISCOUNT_PERCENT } = require('../constants/couponConstants');

const isObjectId = (id) => Boolean(id) && /^[0-9a-fA-F]{24}$/.test(String(id));

const generateOrderNumber = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${date}-${random}`;
};

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getFinalUnitPrice = (price, discountPercent) => {
  const p = Number(price) || 0;
  const d = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  return Math.round(p - (p * d) / 100);
};

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

const calculateTotals = (lines, shippingFeeOverride, couponDiscount = 0, referralDiscount = 0) => {
  const subtotal = lines.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const discountTotal = lines.reduce((sum, l) => sum + l.lineDiscount, 0);
  const taxTotal = lines.reduce((sum, l) => sum + l.taxAmount, 0);
  const afterDiscount = subtotal - discountTotal;

  const coupon = Math.min(Math.max(Math.round(Number(couponDiscount) || 0), 0), afterDiscount);
  const afterCoupon = afterDiscount - coupon;

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

  const maxAllowed = Math.floor((amount * MAX_DISCOUNT_PERCENT) / 100);

  return Math.max(Math.min(Math.round(discount), maxAllowed), 0);
};

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

const reduceStock = async (variantId, size, quantity, { session } = {}) => {
  const result = await Variant.updateOne(
    { _id: variantId, sizes: { $elemMatch: { size: String(size), stock: { $gte: quantity } } } },
    { $inc: { 'sizes.$.stock': -quantity } },
    { session }
  );
  return result.modifiedCount === 1;
};

const restoreStock = async (variantId, size, quantity, { session } = {}) => {
  if (!quantity || quantity < 1) return;
  await Variant.updateOne(
    { _id: variantId, 'sizes.size': String(size) },
    { $inc: { 'sizes.$.stock': quantity } },
    { session }
  );
};

const pushHistory = (item, status, note = '') => {
  item.statusHistory.push({ status, note, updatedAt: new Date() });
};

const remainingQuantity = (item) => (Number(item.quantity) || 0) - (Number(item.cancelledQuantity) || 0);

const ITEM_STAGE = Object.freeze({
  [ITEM_STATUS.PENDING]: 0,
  [ITEM_STATUS.SHIPPED]: 1,
  [ITEM_STATUS.OUT_FOR_DELIVERY]: 2,
  [ITEM_STATUS.DELIVERED]: 3,
  [ITEM_STATUS.RETURN_REQUESTED]: 3,
  [ITEM_STATUS.RETURNED]: 3,
  [ITEM_STATUS.RETURN_REJECTED]: 3,
});

const deriveOrderStatus = (items) => {
  const active = items.filter((i) => i.status !== ITEM_STATUS.CANCELLED && remainingQuantity(i) > 0);
  if (active.length === 0) return ORDER_STATUS.CANCELLED;
  const stage = Math.min(...active.map((i) => ITEM_STAGE[i.status] ?? 0));
  return STATUS_FLOW[stage];
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
  remainingQuantity,
  deriveOrderStatus,
  firstImage: first,
  mongoose,
};
