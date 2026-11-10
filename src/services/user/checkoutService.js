const Cart = require('../../models/cart');
const Wishlist = require('../../models/wishlist');
const Address = require('../../models/address');
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PRICING,
} = require('../../constants/orderConstants');
const {
  isObjectId,
  generateOrderNumber,
  calculateTotals,
  allocateCouponShares,
  reduceStock,
  restoreStock,
} = require('../../utils/orderHelpers');
const { buildLines } = require('../../utils/cartLines');
const { runInTransaction } = require('../../utils/transaction');
const couponService = require('./couponService');
const { getEnabledMethods } = require('../payment/gateways');
const { releaseUserUnpaidOrders } = require('../payment/unpaidOrders');
const walletService = require('./walletService');
const referralService = require('./referralService');

// Checkout summary
const getCheckoutSummary = async (userId) => {
  await releaseUserUnpaidOrders(userId, undefined, { keepRetryable: true });

  const [cart, addresses, walletBalance] = await Promise.all([
    Cart.findOne({ userId }),
    Address.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 }),
    walletService.getBalance(userId),
  ]);

  const lines = await buildLines(cart);
  const buyable = lines.filter((l) => !l.issue);

  const base = buyable.reduce((sum, l) => sum + l.itemTotal, 0);
  const applied = await couponService.resolveAppliedCoupon(userId, cart, base);
  let couponMessage = null;
  if (applied.invalid) {
    await couponService.clearAppliedCoupon(userId);
    couponMessage = MESSAGES.COUPON.COUPON_REMOVED_FROM_CART(applied.invalid.message);
  }

  const referral = await referralService.resolveReferralDiscount(userId, base);
  const totals = calculateTotals(buyable, undefined, applied.discount, referral.discount);
  const defaultAddress = addresses.find((a) => a.isDefault) || null;


  return {
    addresses,
    defaultAddressId: defaultAddress ? String(defaultAddress._id) : null,
    items: lines.map((l) => ({
      productId: String(l.productId),
      variantId: String(l.variantId),
      name: l.name,
      color: l.color,
      size: l.size,
      image: l.image,
      price: l.price,
      discountPercent: l.discountPercent,
      offerName: l.offerName,
      offerSource: l.offerSource,
      finalPrice: l.finalPrice,
      quantity: l.quantity,
      itemTotal: l.itemTotal,
      taxAmount: l.taxAmount,
      stock: l.stock,
      issue: l.issue,
    })),
    pricing: { ...totals, taxPercent: PRICING.TAX_PERCENT },
  
    coupon: applied.coupon
      ? {
          id: String(applied.coupon._id),
          couponCode: applied.coupon.couponCode,
          discountType: applied.coupon.discountType,
          discountValue: applied.coupon.discountValue,
          maximumDiscount: applied.coupon.maximumDiscount ?? null,
          discountAmount: totals.couponDiscount,
          capApplied:
            applied.coupon.discountType === 'percentage' &&
            applied.coupon.maximumDiscount > 0 &&
            (base * applied.coupon.discountValue) / 100 > applied.coupon.maximumDiscount,
        }
      : null,
    couponMessage, 
    referral: {
      eligible: referral.eligible,
      discountAmount: totals.referralDiscount,
      offerAmount: referral.offerAmount || 0,
      minOrderAmount: referral.minOrderAmount,
      hint: referral.hint,
    },
    paymentMethods: [...getEnabledMethods(), PAYMENT_METHODS.WALLET],
    walletBalance,

    canPlaceOrder: lines.length > 0 && buyable.length === lines.length && addresses.length > 0,
  };
};


const assertLinesBuyable = (lines) => {
  for (const l of lines) {
    if (l.issue === 'UNAVAILABLE') {
      throw createError(MESSAGES.CHECKOUT.ITEM_NOT_AVAILABLE(l.name), STATUS.CONFLICT, ERROR_CODES.CART_ITEM_UNAVAILABLE);
    }
    if (l.issue === 'OUT_OF_STOCK') {
      throw createError(MESSAGES.CHECKOUT.ITEM_OUT_OF_STOCK(l.name, l.size), STATUS.CONFLICT, ERROR_CODES.OUT_OF_STOCK);
    }
    if (l.issue === 'INSUFFICIENT_STOCK') {
      throw createError(MESSAGES.CHECKOUT.ITEM_INSUFFICIENT_STOCK(l.name, l.size, l.stock), STATUS.CONFLICT, ERROR_CODES.INSUFFICIENT_STOCK);
    }
  }
};

const rollbackStock = async (taken) => {
  for (const t of taken) {
    try {
      await restoreStock(t.variantId, t.size, t.quantity);
    } catch (err) {
      console.error('Stock rollback failed for', t.variantId, t.size, err.message);
    }
  }
};


// Place order
const placeOrder = async (userId, { addressId, paymentMethod } = {}, { allowOnline = false } = {}) => {
  const isOnline =
    allowOnline &&
    Boolean(paymentMethod) &&
    paymentMethod !== PAYMENT_METHODS.COD &&
    Object.values(PAYMENT_METHODS).includes(paymentMethod);

  if (paymentMethod && paymentMethod !== PAYMENT_METHODS.COD && !isOnline) {
    throw createError(MESSAGES.CHECKOUT.ONLY_COD_IS_AVAILABLE, STATUS.BAD_REQUEST);
  }

  await releaseUserUnpaidOrders(userId);


  let address;
  if (addressId) {
    if (!isObjectId(addressId)) {
      throw createError(MESSAGES.CHECKOUT.INVALID_ADDRESS_ID, STATUS.BAD_REQUEST);
    }
    address = await Address.findOne({ _id: addressId, user: userId });
    if (!address) {
      throw createError(MESSAGES.ADDRESS.ADDRESS_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ADDRESS_NOT_FOUND);
    }
  } else {
    address = await Address.findOne({ user: userId, isDefault: true });
    if (!address) {
      throw createError(MESSAGES.CHECKOUT.ADDRESS_IS_REQUIRED, STATUS.BAD_REQUEST);
    }
  }

  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) {
    throw createError(MESSAGES.CHECKOUT.CART_IS_EMPTY, STATUS.BAD_REQUEST, ERROR_CODES.CART_EMPTY);
  }

  const lines = await buildLines(cart);
  assertLinesBuyable(lines);

  const base = lines.reduce((sum, l) => sum + l.itemTotal, 0);
  const applied = await couponService.resolveAppliedCoupon(userId, cart, base);
  if (applied.invalid) {
    await couponService.clearAppliedCoupon(userId);
    throw createError(applied.invalid.message, STATUS.BAD_REQUEST, applied.invalid.code);
  }
  const coupon = applied.coupon;
  const referral = await referralService.resolveReferralDiscount(userId, base);
  const totals = calculateTotals(lines, undefined, applied.discount, referral.discount);

  const couponShares = allocateCouponShares(lines, totals.couponDiscount);
  const referralShares = allocateCouponShares(lines, totals.referralDiscount);

 
  const createOrderRecords = async (session) => {
    const taken = [];
    let couponRedeemed = false;
    let order = null;

    try {
      for (const l of lines) {
        const ok = await reduceStock(l.variantId, l.size, l.quantity, { session });
        if (!ok) {
          throw createError(MESSAGES.CHECKOUT.ITEM_OUT_OF_STOCK(l.name, l.size), STATUS.CONFLICT, ERROR_CODES.OUT_OF_STOCK);
        }
        taken.push(l);
      }

      if (coupon) {
        couponRedeemed = await couponService.redeemCoupon(coupon._id, { session });
        if (!couponRedeemed) {
          const limitError = createError(MESSAGES.COUPON.COUPON_LIMIT_REACHED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_LIMIT_REACHED);
          limitError.clearCoupon = true;
          throw limitError;
        }
      }

      const [created] = await Order.create(
        [
          {
            orderNumber: generateOrderNumber(),
            userId,
            shippingAddress: {
              name: address.name,
              addressType: address.addressType,
              detailedAddress: address.detailedAddress,
              city: address.city,
              country: address.country,
              pinCode: address.pinCode,
              phoneNumber: address.phoneNumber,
              email: address.email || '',
            },
            ...totals,
            couponId: coupon ? coupon._id : null,
            couponCode: coupon ? coupon.couponCode : null,
            referralReward: totals.referralDiscount > 0 ? referral.reward : 0,
            status: ORDER_STATUS.PENDING,
            paymentMethod: isOnline ? paymentMethod : PAYMENT_METHODS.COD,
            paymentStatus: PAYMENT_STATUS.PENDING,
          },
        ],
        { session }
      );
      order = created;

      await OrderItem.insertMany(
        lines.map((l, index) => ({
          orderId: order._id,
          productId: l.productId,
          variantId: l.variantId,
          name: l.name,
          color: l.color,
          size: l.size,
          image: l.image,
          price: l.price,
          discountPercent: l.discountPercent,
          offerName: l.offerName,
          offerSource: l.offerSource,
          finalPrice: l.finalPrice,
          quantity: l.quantity,
          itemTotal: l.itemTotal,
          taxAmount: l.taxAmount,
          couponShare: couponShares[index],
          referralShare: referralShares[index],
          status: ITEM_STATUS.PENDING,
          statusHistory: [{ status: ITEM_STATUS.PENDING, note: 'Order placed', updatedAt: new Date() }],
        })),
        { session }
      );

      return order;
    } catch (err) {
      if (!session) {
        await rollbackStock(taken);
        if (couponRedeemed) await couponService.releaseCoupon(coupon._id);
        if (order) {
          await OrderItem.deleteMany({ orderId: order._id });
          await Order.deleteOne({ _id: order._id });
        }
      }
      throw err;
    }
  };

  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await runInTransaction(createOrderRecords);
    } catch (err) {
      if (err.clearCoupon) await couponService.clearAppliedCoupon(userId);
      if (err.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }
  if (!order) throw new Error('Could not generate a unique order number');

  if (!isOnline) {
    try {
      await Cart.updateOne({ userId }, { $set: { items: [], couponId: null } });
      await Wishlist.updateOne(
        { userId },
        { $pull: { items: { $or: lines.map((l) => ({ variantId: l.variantId, size: l.size })) } } }
      );
    } catch (err) {
      console.error('Cart/wishlist cleanup failed after order', order.orderNumber, err.message);
    }
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscount,
    referralDiscount: order.referralDiscount || 0,
    paymentMethod: order.paymentMethod,
  };
};

module.exports = { getCheckoutSummary, placeOrder };
