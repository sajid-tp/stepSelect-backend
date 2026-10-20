// src/services/user/checkoutService.js
const Cart = require('../../models/cart');
const Wishlist = require('../../models/wishlist');
const Address = require('../../models/address');
const Variant = require('../../models/variants');
const Product = require('../../models/products');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');
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
  ESTIMATED_DELIVERY_DAYS,
  toPublicStatus,
} = require('../../constants/orderConstants');
const {
  isObjectId,
  generateOrderNumber,
  calculateLine,
  calculateTotals,
  reduceStock,
  restoreStock,
  firstImage,
  addDays,
} = require('../../utils/orderHelpers');

const isVisible = (doc) => Boolean(doc && doc.isActive && !doc.deletedAt);

// Internal Helper: turn the cart (only pointers) into priced lines with a problem flag.
// Prices ALWAYS come from the database, never from the frontend.
const buildLines = async (cart) => {
  if (!cart || cart.items.length === 0) return [];

  const variants = await Variant.find({ _id: { $in: cart.items.map((i) => i.variantId) } });
  const products = await Product.find({ _id: { $in: variants.map((v) => v.productId) } });
  const categories = await Category.find({ _id: { $in: products.map((p) => p.categoryId) } });
  const brands = await Brand.find({ _id: { $in: products.map((p) => p.brandId) } });

  return cart.items.map((item) => {
    const variant = variants.find((v) => String(v._id) === String(item.variantId));
    const product = variant ? products.find((p) => String(p._id) === String(variant.productId)) : null;
    const category = product ? categories.find((c) => String(c._id) === String(product.categoryId)) : null;
    const brand = product ? brands.find((b) => String(b._id) === String(product.brandId)) : null;
    const sizeEntry = variant ? variant.sizes.find((s) => String(s.size) === item.size) : null;
    const stock = sizeEntry ? sizeEntry.stock || 0 : 0;

    let issue = null;
    if (!isVisible(variant) || !isVisible(product) || !isVisible(category) || !isVisible(brand) || !sizeEntry) {
      issue = 'UNAVAILABLE';
    } else if (stock < 1) {
      issue = 'OUT_OF_STOCK';
    } else if (stock < item.quantity) {
      issue = 'INSUFFICIENT_STOCK';
    }

    const price = variant ? Number(variant.price) || 0 : 0;
    const discountPercent = variant ? Number(variant.discountPercent) || 0 : 0;
    const money = calculateLine(price, discountPercent, item.quantity);

    return {
      productId: variant ? variant.productId : null,
      variantId: item.variantId,
      name: product ? product.productName : 'Unavailable product',
      color: variant ? variant.color : '',
      size: item.size,
      image: variant ? firstImage(variant.images) : null,
      price,
      discountPercent,
      quantity: item.quantity,
      stock,
      issue,
      ...money,
    };
  });
};

// Address as the checkout page needs it: the saved fields plus `id` and `defaultAddress`
const toAddressView = (address) => {
  const plain = typeof address.toObject === 'function' ? address.toObject() : address;
  return { ...plain, id: String(plain._id), defaultAddress: Boolean(plain.isDefault) };
};

// 1. Checkout summary: addresses + priced items + totals
const getCheckoutSummary = async (userId) => {
  const [cart, addresses] = await Promise.all([
    Cart.findOne({ userId }),
    Address.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 }),
  ]);

  const lines = await buildLines(cart);
  const buyable = lines.filter((l) => !l.issue);
  const totals = calculateTotals(buyable);
  const defaultAddress = addresses.find((a) => a.isDefault) || null;

  return {
    addresses: addresses.map(toAddressView),
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
    subtotal: totals.subtotal,
    couponDiscount: 0,                 // coupons are not part of the COD-only release
    total: totals.totalAmount,
    walletBalance: 0,                  // wallet is not part of the COD-only release
    pricing: { ...totals, taxPercent: PRICING.TAX_PERCENT },
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
      throw createError(MESSAGES.CHECKOUT.ITEM_INSUFFICIENT_STOCK(l.name, l.size, l.stock), STATUS.CONFLICT, ERROR_CODES.OUT_OF_STOCK);
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
//    shippingAddress = the addressId to ship to (`addressId` is accepted too; falls back to the default address)
//    couponId        = coupons are not available yet, so a coupon is refused instead of silently ignored
const placeOrder = async (userId, { shippingAddress, addressId, couponId, paymentMethod } = {}) => {
  if (paymentMethod && String(paymentMethod).toUpperCase() !== PAYMENT_METHODS.COD) {
    throw createError(MESSAGES.CHECKOUT.ONLY_COD_IS_AVAILABLE, STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST);
  }
  if (couponId) {
    throw createError(MESSAGES.CHECKOUT.COUPONS_NOT_AVAILABLE, STATUS.BAD_REQUEST, ERROR_CODES.COUPON_NOT_AVAILABLE);
  }

  // Address: the one chosen, or the default one
  const chosenAddress = shippingAddress || addressId;
  let address;
  if (chosenAddress) {
    // A malformed id can never match an address, so it gets the same "not found" answer
    address = isObjectId(chosenAddress) ? await Address.findOne({ _id: chosenAddress, user: userId }) : null;
    if (!address) {
      throw createError(MESSAGES.CHECKOUT.SHIPPING_ADDRESS_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.ADDRESS_NOT_FOUND);
    }
  } else {
    address = await Address.findOne({ user: userId, isDefault: true });
    if (!address) {
      throw createError(MESSAGES.CHECKOUT.ADDRESS_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
  }

  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) {
    throw createError(MESSAGES.CHECKOUT.CART_IS_EMPTY, STATUS.BAD_REQUEST, ERROR_CODES.CART_EMPTY);
  }

  const lines = await buildLines(cart);
  assertLinesBuyable(lines);

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

  // Create the order. The order number is random, so on the rare duplicate we just try again.
  const totals = calculateTotals(lines);
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
          status: ORDER_STATUS.PENDING,
          paymentMethod: PAYMENT_METHODS.COD,
          paymentStatus: PAYMENT_STATUS.PENDING,
          estimatedDelivery: addDays(new Date(), ESTIMATED_DELIVERY_DAYS),
        });
      } catch (err) {
        if (err.code !== 11000) throw err; // only retry duplicate order numbers
      }
    }
    if (!order) throw new Error('Could not generate a unique order number');

    await OrderItem.insertMany(
      lines.map((l) => ({
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
        status: ITEM_STATUS.PENDING,
        statusHistory: [{ status: ITEM_STATUS.PENDING, note: 'Order placed', updatedAt: new Date() }],
      }))
    );
  } catch (err) {
    // Something broke after stock was taken: undo everything so no stock is lost
    await rollbackStock(taken);
    if (order) {
      await OrderItem.deleteMany({ orderId: order._id });
      await Order.deleteOne({ _id: order._id });
    }
    throw err;
  }

  // The order is placed. Cleaning up cart and wishlist must never fail the order.
  try {
    await Cart.updateOne({ userId }, { $set: { items: [] } });
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
    status: toPublicStatus(order.status, 'user'),   // "placed"
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
};

module.exports = { getCheckoutSummary, placeOrder };
