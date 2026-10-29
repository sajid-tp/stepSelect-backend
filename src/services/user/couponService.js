
const mongoose = require('mongoose');
const Cart = require('../../models/cart');
const Coupon = require('../../models/coupon');
const Order = require('../../models/order');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { ORDER_STATUS } = require('../../constants/orderConstants');
const { buildLines } = require('../../utils/cartLines');
const { calculateTotals, calculateCouponDiscount } = require('../../utils/orderHelpers');

const liveCouponFilter = (now = new Date()) => ({
  deletedAt: null,
  isActive: true,
  $and: [
    { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
    { $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] },
    {
     
      $expr: {
        $or: [
          { $not: [{ $gt: ['$redemptionLimit', 0] }] },
          { $lt: ['$usedCount', '$redemptionLimit'] },
        ],
      },
    },
  ],
});


const getUserUsage = async (userId, couponIds = null) => {
  const match = {
    userId: new mongoose.Types.ObjectId(String(userId)),
    couponId: couponIds ? { $in: couponIds } : { $ne: null },
    status: { $ne: ORDER_STATUS.CANCELLED },
  };
  const rows = await Order.aggregate([
    { $match: match },
    { $group: { _id: '$couponId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};


const getCartPricing = async (userId) => {
  const cart = await Cart.findOne({ userId });
  const lines = await buildLines(cart);
  const buyable = lines.filter((l) => !l.issue);
  const base = buyable.reduce((sum, l) => sum + l.itemTotal, 0);
  return { cart, buyable, base };
};

const clearAppliedCoupon = async (userId) => {
  await Cart.updateOne({ userId }, { $set: { couponId: null } });
};


const assertCouponUsable = async (coupon, { userId, base, usedByUser, now = new Date() }) => {
  if (!coupon || coupon.deletedAt) {
    throw createError(MESSAGES.COUPON.COUPON_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.COUPON_NOT_FOUND);
  }
  if (!coupon.isActive) {
    throw createError(MESSAGES.COUPON.COUPON_NOT_ACTIVE, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_INACTIVE);
  }
  if (coupon.startDate && coupon.startDate > now) {
    throw createError(MESSAGES.COUPON.COUPON_NOT_STARTED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_NOT_STARTED);
  }
  if (coupon.expiryDate && coupon.expiryDate < now) {
    throw createError(MESSAGES.COUPON.COUPON_EXPIRED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_EXPIRED);
  }
  if (coupon.redemptionLimit && coupon.usedCount >= coupon.redemptionLimit) {
    throw createError(MESSAGES.COUPON.COUPON_LIMIT_REACHED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_LIMIT_REACHED);
  }

  const used =
    usedByUser !== undefined
      ? usedByUser
      : await Order.countDocuments({
          userId,
          couponId: coupon._id,
          status: { $ne: ORDER_STATUS.CANCELLED },
        });
  if (used >= (coupon.usageLimitPerUser || 1)) {
    throw createError(MESSAGES.COUPON.COUPON_ALREADY_USED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_ALREADY_USED);
  }

  if (base < (coupon.minimumPurchase || 0)) {
    const shortfall = Math.ceil((coupon.minimumPurchase || 0) - base);
    throw createError(
      MESSAGES.COUPON.MINIMUM_PURCHASE_NOT_MET(shortfall),
      STATUS.BAD_REQUEST,
      ERROR_CODES.MINIMUM_PURCHASE_NOT_MET
    );
  }
};


const getAvailableCoupons = async (userId) => {
  const [coupons, { cart, base }] = await Promise.all([
    Coupon.find(liveCouponFilter()).sort({ createdAt: -1, _id: -1 }),
    getCartPricing(userId),
  ]);


  const usage = await getUserUsage(userId, coupons.map((c) => c._id));
  const appliedId = cart && cart.couponId ? String(cart.couponId) : null;

  const available = coupons
    .filter((c) => (usage.get(String(c._id)) || 0) < (c.usageLimitPerUser || 1))
    .map((c) => {
      const minimum = c.minimumPurchase || 0;
      const isApplicable = base > 0 && base >= minimum;
      return {
        id: String(c._id),
        couponCode: c.couponCode,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minimumPurchase: minimum,
        maximumDiscount: c.maximumDiscount,
        expiryDate: c.expiryDate,
      
        isApplicable,
        amountNeeded: isApplicable ? 0 : Math.max(Math.ceil(minimum - base), 0),
        estimatedDiscount: isApplicable ? calculateCouponDiscount(c, base) : 0,
        isApplied: appliedId === String(c._id),
      };
    });

  return { coupons: available };
};


const applyCoupon = async (userId, couponCode) => {
  const code = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
  if (!code) {
    throw createError(MESSAGES.COUPON.COUPON_CODE_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_CODE_REQUIRED);
  }

  const { buyable, base } = await getCartPricing(userId);
  if (buyable.length === 0) {
    throw createError(MESSAGES.CHECKOUT.CART_IS_EMPTY, STATUS.BAD_REQUEST, ERROR_CODES.CART_EMPTY);
  }

  const coupon = await Coupon.findOne({ couponCode: code, deletedAt: null });
  await assertCouponUsable(coupon, { userId, base });

  const discountAmount = calculateCouponDiscount(coupon, base);
  const totals = calculateTotals(buyable, undefined, discountAmount);


  await Cart.updateOne({ userId }, { $set: { couponId: coupon._id } });

  return {
    couponId: String(coupon._id),
    couponCode: coupon.couponCode,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    subtotal: totals.subtotal - totals.discountTotal, 
    newTotal: totals.totalAmount,
  };
};


const removeCoupon = async (userId) => {
  await clearAppliedCoupon(userId);

  const { buyable } = await getCartPricing(userId);
  const totals = calculateTotals(buyable);
  return { message: MESSAGES.COUPON.COUPON_REMOVED, newTotal: totals.totalAmount };
};


const resolveAppliedCoupon = async (userId, cart, base) => {
  if (!cart || !cart.couponId) return { coupon: null, discount: 0, invalid: null };

  const coupon = await Coupon.findOne({ _id: cart.couponId, deletedAt: null });
  try {
    await assertCouponUsable(coupon, { userId, base });
  } catch (err) {
    if (!err.statusCode) throw err; // unexpected error, not a coupon rule
    return { coupon: null, discount: 0, invalid: { code: err.code, message: err.message } };
  }
  return { coupon, discount: calculateCouponDiscount(coupon, base), invalid: null };
};


const redeemCoupon = async (couponId) => {
  const updated = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      deletedAt: null,
      isActive: true,
      $expr: {
        $or: [
          { $not: [{ $gt: ['$redemptionLimit', 0] }] },
          { $lt: ['$usedCount', '$redemptionLimit'] },
        ],
      },
    },
    { $inc: { usedCount: 1 } },
    { returnDocument: 'after' }
  );
  return Boolean(updated);
};


const releaseCoupon = async (couponId) => {
  if (!couponId) return;
  await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
};

module.exports = {
  getAvailableCoupons,
  applyCoupon,
  removeCoupon,

  assertCouponUsable,
  resolveAppliedCoupon,
  clearAppliedCoupon,
  redeemCoupon,
  releaseCoupon,
};
