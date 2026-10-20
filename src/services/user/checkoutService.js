// src/services/user/checkoutService.js
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
const couponService = require('./couponService');

// 1. Checkout summary: addresses + priced items + totals
const getCheckoutSummary = async (userId) => {
  const [cart, addresses] = await Promise.all([
    Cart.findOne({ userId }),
    Address.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 }),
  ]);

  const lines = await buildLines(cart);
  const buyable = lines.filter((l) => !l.issue);

  // Re-check the coupon saved on the cart against the CURRENT cart (items may have changed)
  const base = buyable.reduce((sum, l) => sum + l.itemTotal, 0);
  const applied = await couponService.resolveAppliedCoupon(userId, cart, base);
  let couponMessage = null;
  if (applied.invalid) {
    await couponService.clearAppliedCoupon(userId); // stale coupon: drop it so the page and the order agree
    couponMessage = MESSAGES.COUPON.COUPON_REMOVED_FROM_CART(applied.invalid.message);
  }

  const totals = calculateTotals(buyable, undefined, applied.discount);
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
      finalPrice: l.finalPrice,
      quantity: l.quantity,
      itemTotal: l.itemTotal,
      taxAmount: l.taxAmount,
      stock: l.stock,
      issue: l.issue,
    })),
    pricing: { ...totals, taxPercent: PRICING.TAX_PERCENT },
    // null when no coupon is applied
    coupon: applied.coupon
      ? {
          id: String(applied.coupon._id),
          couponCode: applied.coupon.couponCode,
          discountType: applied.coupon.discountType,
          discountValue: applied.coupon.discountValue,
          discountAmount: totals.couponDiscount,
        }
      : null,
    couponMessage, // set only when an applied coupon had to be removed (explain it to the user)
    paymentMethods: [PAYMENT_METHODS.COD],
    // The page should disable "Place order" unless this is true
    canPlaceOrder: lines.length > 0 && buyable.length === lines.length && addresses.length > 0,
  };
};

// Internal Helper: stop with a clear message if any line cannot be bought
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

// Internal Helper: give stock back for lines we already took it from
const rollbackStock = async (taken) => {
  for (const t of taken) {
    try {
      await restoreStock(t.variantId, t.size, t.quantity);
    } catch (err) {
      console.error('Stock rollback failed for', t.variantId, t.size, err.message);
    }
  }
};

// 2. Place order (Cash on Delivery)
const placeOrder = async (userId, { addressId, paymentMethod } = {}) => {
  if (paymentMethod && paymentMethod !== PAYMENT_METHODS.COD) {
    throw createError(MESSAGES.CHECKOUT.ONLY_COD_IS_AVAILABLE, STATUS.BAD_REQUEST);
  }

  // Address: the one chosen, or the default one
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

  // Coupon: the one saved on the cart, re-checked right now. The frontend cannot choose a discount.
  const base = lines.reduce((sum, l) => sum + l.itemTotal, 0);
  const applied = await couponService.resolveAppliedCoupon(userId, cart, base);
  if (applied.invalid) {
    await couponService.clearAppliedCoupon(userId); // so the user can simply try again without it
    throw createError(applied.invalid.message, STATUS.BAD_REQUEST, applied.invalid.code);
  }
  const coupon = applied.coupon;
  const totals = calculateTotals(lines, undefined, applied.discount);

  // Take stock line by line. If any line fails (someone bought it a moment ago), give back what we took.
  const taken = [];
  for (const l of lines) {
    const ok = await reduceStock(l.variantId, l.size, l.quantity);
    if (!ok) {
      await rollbackStock(taken);
      throw createError(MESSAGES.CHECKOUT.ITEM_OUT_OF_STOCK(l.name, l.size), STATUS.CONFLICT, ERROR_CODES.OUT_OF_STOCK);
    }
    taken.push(l);
  }

  // Count the coupon use (atomic, so the last redemption can only go to one order)
  let couponRedeemed = false;
  if (coupon) {
    couponRedeemed = await couponService.redeemCoupon(coupon._id);
    if (!couponRedeemed) {
      await rollbackStock(taken);
      await couponService.clearAppliedCoupon(userId);
      throw createError(MESSAGES.COUPON.COUPON_LIMIT_REACHED, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_LIMIT_REACHED);
    }
  }
  const couponShares = allocateCouponShares(lines, totals.couponDiscount);

  // Create the order. The order number is random, so on the rare duplicate we just try again.
  let order = null;
  try {
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      try {
        order = await Order.create({
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
          status: ORDER_STATUS.PENDING,
          paymentMethod: PAYMENT_METHODS.COD,
          paymentStatus: PAYMENT_STATUS.PENDING,
        });
      } catch (err) {
        if (err.code !== 11000) throw err; // only retry duplicate order numbers
      }
    }
    if (!order) throw new Error('Could not generate a unique order number');

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
        finalPrice: l.finalPrice,
        quantity: l.quantity,
        itemTotal: l.itemTotal,
        taxAmount: l.taxAmount,
        couponShare: couponShares[index],
        status: ITEM_STATUS.PENDING,
        statusHistory: [{ status: ITEM_STATUS.PENDING, note: 'Order placed', updatedAt: new Date() }],
      }))
    );
  } catch (err) {
    // Something broke after stock was taken: undo everything so no stock or coupon use is lost
    await rollbackStock(taken);
    if (couponRedeemed) await couponService.releaseCoupon(coupon._id);
    if (order) {
      await OrderItem.deleteMany({ orderId: order._id });
      await Order.deleteOne({ _id: order._id });
    }
    throw err;
  }

  // The order is placed. Cleaning up cart and wishlist must never fail the order.
  try {
    await Cart.updateOne({ userId }, { $set: { items: [], couponId: null } });
    await Wishlist.updateOne(
      { userId },
      { $pull: { items: { $or: lines.map((l) => ({ variantId: l.variantId, size: l.size })) } } }
    );
  } catch (err) {
    console.error('Cart/wishlist cleanup failed after order', order.orderNumber, err.message);
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscount,
    paymentMethod: order.paymentMethod,
  };
};

module.exports = { getCheckoutSummary, placeOrder };
