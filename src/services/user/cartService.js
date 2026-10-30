// src/services/user/cartService.js
const Cart = require('../../models/cart');
const Wishlist = require('../../models/wishlist');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const { getOfferMap, resolveDiscount } = require('./offerService');
const { getFinalUnitPrice } = require('../../utils/orderHelpers');

const MAX_QUANTITY_PER_ITEM = 5;

// Internal Helper: check variantId and size, return the cleaned size
const validateCartInput = (variantId, size) => {
  if (!variantId || !/^[0-9a-fA-F]{24}$/.test(variantId)) {
    throw createError(MESSAGES.VARIANT.INVALID_VARIANT_ID, STATUS.BAD_REQUEST);
  }

  if (!size || !String(size).trim()) {
    throw createError(MESSAGES.CART.SIZE_IS_REQUIRED, STATUS.BAD_REQUEST);
  }

  return String(size).trim();
};

// Internal Helper: check quantity is a whole number of at least 1
const validateQuantity = (quantity) => {
  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty < 1) {
    throw createError(MESSAGES.CART.QUANTITY_MUST_BE_WHOLE_NUMBER_AT_LEAST_1, STATUS.BAD_REQUEST);
  }

  return qty;
};

// Internal Helper: find the same variant + same size in the cart
const findItem = (cart, variantId, size) => {
  return cart.items.find(
    (item) => String(item.variantId) === String(variantId) && item.size === size
  );
};

// Internal Helper: make sure the variant can be bought, return stock of that size
const getStock = async (variantId, size) => {
  const variant = await Variant.findOne({ _id: variantId, isActive: true, deletedAt: null });
  if (!variant) {
    throw createError(MESSAGES.CART.PRODUCT_VARIANT_NOT_FOUND, STATUS.NOT_FOUND);
  }

  const product = await Product.findOne({ _id: variant.productId, isActive: true, deletedAt: null });
  if (!product) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_IS_CURRENTLY_UNAVAILABLE, STATUS.NOT_FOUND);
  }

  const sizeEntry = variant.sizes.find((s) => String(s.size) === size);
  if (!sizeEntry) {
    throw createError(MESSAGES.CART.SELECTED_SIZE_IS_NOT_AVAILABLE, STATUS.BAD_REQUEST);
  }

  return sizeEntry.stock || 0;
};

// Internal Helper: check the new total quantity against the limit and the stock
const checkQuantity = (total, stock) => {
  if (total > MAX_QUANTITY_PER_ITEM) {
    throw createError(MESSAGES.CART.MAX_QUANTITY_PER_ITEM_EXCEEDED(MAX_QUANTITY_PER_ITEM), STATUS.BAD_REQUEST);
  }

  if (stock < 1) {
    throw createError(MESSAGES.CART.THIS_SIZE_IS_OUT_OF_STOCK, STATUS.CONFLICT);
  }

  if (total > stock) {
    throw createError(MESSAGES.CART.ONLY_STOCK_LEFT_FOR_SIZE(stock), STATUS.CONFLICT);
  }
};

// Internal Helper: turn the saved cart (only pointers) into what the page shows
const buildCartView = async (cart) => {
  const view = {
    id: cart ? String(cart._id) : null,
    items: [],
    totalPrice: 0, // what the customer pays for the items (after product / category offers)
    totalMrp: 0, // the same items at their normal price
    totalSavings: 0, // totalMrp - totalPrice
    totalItems: 0,
    maxQuantityPerItem: MAX_QUANTITY_PER_ITEM,
  };

  if (!cart || cart.items.length === 0) return view;

  // Get every variant and product the cart points to
  const variantIds = cart.items.map((item) => item.variantId);
  const variants = await Variant.find({ _id: { $in: variantIds } });

  const productIds = variants.map((variant) => variant.productId);
  const products = await Product.find({ _id: { $in: productIds } });
  const offerMap = await getOfferMap(products.map((p) => ({ productId: p._id, categoryId: p.categoryId })));

  for (const item of cart.items) {
    const variant = variants.find((v) => String(v._id) === String(item.variantId));
    const product = variant
      ? products.find((p) => String(p._id) === String(variant.productId))
      : null;

    // Stock of the chosen size
    let stock = 0;
    if (variant) {
      const sizeEntry = variant.sizes.find((s) => String(s.size) === item.size);
      if (sizeEntry) stock = sizeEntry.stock || 0;
    }

    // Is there a problem with this item?
    let issue = null;
    if (
      !variant ||
      !product ||
      !variant.isActive ||
      variant.deletedAt ||
      !product.isActive ||
      product.deletedAt
    ) {
      issue = 'UNAVAILABLE';
    } else if (stock < 1) {
      issue = 'OUT_OF_STOCK';
    } else if (stock < item.quantity) {
      issue = 'INSUFFICIENT_STOCK';
    }
    const isAvailable = issue === null;

    // First image (can be a plain string or an object with url)
    let image = null;
    if (variant && variant.images && variant.images.length > 0) {
      const first = variant.images[0];
      image = typeof first === 'string' ? first : first.url || null;
    }

    const price = variant ? variant.price || 0 : null;

    // Offer price: the larger of the product offer and the category offer
    const { discountPercent, offer } = resolveDiscount(
      product ? offerMap.get(String(product._id)) : null,
      variant ? variant.discountPercent : 0
    );
    const finalPrice = price === null ? null : getFinalUnitPrice(price, discountPercent);
    const lineTotal = finalPrice === null ? 0 : finalPrice * item.quantity;
    const lineMrp = price === null ? 0 : price * item.quantity;

    // Only items that can be bought count towards the total price
    if (isAvailable) {
      view.totalPrice += lineTotal;
      view.totalMrp += lineMrp;
    }
    view.totalItems += item.quantity;

    view.items.push({
      productId: variant ? String(variant.productId) : null,
      variantId: String(item.variantId),
      name: product ? product.productName : null,
      color: variant ? variant.color : null,
      size: item.size,
      image,
      price,
      discountPercent,
      finalPrice,
      offer,
      quantity: item.quantity,
      lineTotal,
      stock,
      maxQuantity: Math.min(MAX_QUANTITY_PER_ITEM, stock),
      isAvailable,
      issue,
    });
  }

  view.totalSavings = view.totalMrp - view.totalPrice;
  return view;
};

// 1. Get Cart
const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId });
  return await buildCartView(cart);
};

// 2. Add To Cart
const addToCart = async (userId, { variantId, size, quantity }) => {
  const sizeValue = validateCartInput(variantId, size);
  const qty = validateQuantity(quantity === undefined ? 1 : quantity);

  const stock = await getStock(variantId, sizeValue);

  let cart = await Cart.findOne({ userId });
  if (!cart) cart = new Cart({ userId, items: [] });

  // Same variant + size already in the cart? Then add to its quantity
  const existing = findItem(cart, variantId, sizeValue);
  const total = (existing ? existing.quantity : 0) + qty;

  checkQuantity(total, stock);

  if (existing) {
    existing.quantity = total;
  } else {
    cart.items.push({ variantId, size: sizeValue, quantity: qty });
  }

  await cart.save();

  // Moved to cart: take this colour + size off the wishlist (if it was there)
  await Wishlist.updateOne({ userId }, { $pull: { items: { variantId, size: sizeValue } } });

  return await buildCartView(cart);
};

// 3. Update Cart Item Quantity
const updateCartItem = async (userId, variantId, size, quantity) => {
  const sizeValue = validateCartInput(variantId, size);
  const qty = validateQuantity(quantity);

  const cart = await Cart.findOne({ userId });
  const item = cart ? findItem(cart, variantId, sizeValue) : null;
  if (!item) {
    throw createError(MESSAGES.CART.ITEM_NOT_FOUND_IN_CART, STATUS.NOT_FOUND);
  }

  // Limit and stock only matter when the quantity goes up
  if (qty > item.quantity) {
    const stock = await getStock(variantId, sizeValue);
    checkQuantity(qty, stock);
  }

  item.quantity = qty;
  await cart.save();
  return await buildCartView(cart);
};

// 4. Remove Cart Item
const removeCartItem = async (userId, variantId, size) => {
  const sizeValue = validateCartInput(variantId, size);

  const cart = await Cart.findOne({ userId });
  const item = cart ? findItem(cart, variantId, sizeValue) : null;
  if (!item) {
    throw createError(MESSAGES.CART.ITEM_NOT_FOUND_IN_CART, STATUS.NOT_FOUND);
  }

  cart.items = cart.items.filter((i) => i !== item);
  await cart.save();
  return await buildCartView(cart);
};

// 5. Clear Cart
const clearCart = async (userId) => {
  const cart = await Cart.findOneAndUpdate(
    { userId },
    { $set: { items: [], couponId: null } },
    { new: true }
  );
  return await buildCartView(cart);
};

module.exports = {
  MAX_QUANTITY_PER_ITEM,
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
