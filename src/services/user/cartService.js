// src/services/user/cartService.js
const Cart = require('../../models/cart');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const MAX_QUANTITY_PER_ITEM = 5;

const isObjectId = (value) =>
  typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);

const assertVariantId = (variantId) => {
  if (!isObjectId(variantId)) {
    throw createError(MESSAGES.VARIANT.INVALID_VARIANT_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_VARIANT_ID);
  }
};

const parseSize = (size) => {
  const value =
    typeof size === 'string' || typeof size === 'number' ? String(size).trim() : '';

  if (!value) throw createError(MESSAGES.CART.SIZE_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.SIZE_REQUIRED);
  return value;
};


const parseQuantity = (quantity) => {
  const isNumeric =
    typeof quantity === 'number' ||
    (typeof quantity === 'string' && /^\d+$/.test(quantity.trim()));
  const qty = isNumeric ? Number(quantity) : NaN;

  if (!Number.isInteger(qty) || qty < 1) {
    throw createError(MESSAGES.CART.QUANTITY_MUST_BE_WHOLE_NUMBER_AT_LEAST_1, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_QUANTITY);
  }
  return qty;
};


const assertWithinLimit = (total) => {
  if (total > MAX_QUANTITY_PER_ITEM) {
    throw createError(
      MESSAGES.CART.MAX_QUANTITY_PER_ITEM_EXCEEDED(MAX_QUANTITY_PER_ITEM),
      STATUS.BAD_REQUEST,
      ERROR_CODES.MAX_QUANTITY_EXCEEDED
    );
  }
};


const assertQuantityAllowed = (total, stock) => {
  assertWithinLimit(total);

  if (stock < 1) {
    throw createError(MESSAGES.CART.THIS_SIZE_IS_OUT_OF_STOCK, STATUS.CONFLICT, ERROR_CODES.OUT_OF_STOCK);
  }
  if (total > stock) {
    throw createError(MESSAGES.CART.ONLY_STOCK_LEFT_FOR_SIZE(stock), STATUS.CONFLICT, ERROR_CODES.INSUFFICIENT_STOCK);
  }
};


const getUnitPrice = (variant) => {
  const price = Number(variant.price) || 0;
  const discount = Math.min(Math.max(Number(variant.discountPercent) || 0, 0), 100);
  return Math.round(price - (price * discount) / 100);
};


const getImage = (variant) => {
  const first = variant?.images?.[0];
  if (!first) return null;
  return typeof first === 'string' ? first : first.url || null;
};


const sameLine = (item, variantId, size) =>
  String(item.variantId) === String(variantId) && item.size === size;


const getOrCreateCart = async (userId) =>
  (await Cart.findOne({ userId })) || new Cart({ userId, items: [] });


const userLocks = new Map();

const withUserLock = (userId, task) => {
  const key = String(userId);
  const previous = userLocks.get(key) || Promise.resolve();

  const run = previous.then(task);
  const tail = run.catch(() => {});

  userLocks.set(key, tail);
  tail.then(() => {
    if (userLocks.get(key) === tail) userLocks.delete(key);
  });

  return run;
};


const loadPurchasable = async (variantId, size) => {
  const variant = await Variant.findOne({
    _id: variantId,
    isActive: true,
    deletedAt: null,
  })
    .select('productId sizes')
    .lean();

  if (!variant) {
    throw createError(MESSAGES.CART.PRODUCT_VARIANT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.VARIANT_NOT_FOUND);
  }

  const product = await Product.findOne({
    _id: variant.productId,
    isActive: true,
    deletedAt: null,
  })
    .select('_id')
    .lean();

  if (!product) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_IS_CURRENTLY_UNAVAILABLE, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_UNAVAILABLE);
  }

  const sizeEntry = (variant.sizes || []).find((s) => String(s.size) === size);
  if (!sizeEntry) {
    throw createError(MESSAGES.CART.SELECTED_SIZE_IS_NOT_AVAILABLE, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_SIZE);
  }

  return { variant, stock: sizeEntry.stock || 0 };
};


const getItemIssue = (variant, product, stock, quantity) => {
  if (
    !variant ||
    !product ||
    !variant.isActive ||
    variant.deletedAt ||
    !product.isActive ||
    product.deletedAt
  ) {
    return 'UNAVAILABLE';
  }
  if (stock < 1) return 'OUT_OF_STOCK';
  if (stock < quantity) return 'INSUFFICIENT_STOCK';
  return null;
};


const buildCartView = async (cart) => {
  const items = cart?.items || [];

  const view = {
    id: cart?._id ? String(cart._id) : null,
    items: [],
    totalPrice: 0,
    totalItems: 0,
    maxQuantityPerItem: MAX_QUANTITY_PER_ITEM,
  };

  if (items.length === 0) return view;


  const variants = await Variant.find({ _id: { $in: items.map((i) => i.variantId) } })
    .select('productId color price discountPercent images sizes isActive deletedAt')
    .lean();

  const products = await Product.find({ _id: { $in: variants.map((v) => v.productId) } })
    .select('productName isActive deletedAt')
    .lean();

  const variantMap = new Map(variants.map((v) => [String(v._id), v]));
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  view.items = items.map((item) => {
    const variant = variantMap.get(String(item.variantId));
    const product = variant ? productMap.get(String(variant.productId)) : undefined;

    const sizeEntry = variant?.sizes?.find((s) => String(s.size) === item.size);
    const stock = sizeEntry?.stock || 0;

    const issue = getItemIssue(variant, product, stock, item.quantity);
    const isAvailable = issue === null;

    const price = variant ? getUnitPrice(variant) : null;
    const lineTotal = price === null ? 0 : price * item.quantity;


    if (isAvailable) view.totalPrice += lineTotal;
    view.totalItems += item.quantity;

    return {
      productId: variant ? String(variant.productId) : null,
      variantId: String(item.variantId),
      name: product?.productName ?? null,
      color: variant?.color ?? null,
      size: item.size,
      image: getImage(variant),
      price,
      quantity: item.quantity,
      lineTotal,
      stock,
      maxQuantity: Math.min(MAX_QUANTITY_PER_ITEM, stock),
      isAvailable,
      issue,
    };
  });

  return view;
};



const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId });
  return buildCartView(cart);
};


const addToCart = async (userId, { variantId, size, quantity } = {}) => {
  assertVariantId(variantId);
  const sizeValue = parseSize(size);
  const qty = parseQuantity(quantity === undefined ? 1 : quantity);

  return withUserLock(userId, async () => {
    const { stock } = await loadPurchasable(variantId, sizeValue);

    const cart = await getOrCreateCart(userId);
    const existing = cart.items.find((item) => sameLine(item, variantId, sizeValue));


    assertQuantityAllowed((existing ? existing.quantity : 0) + qty, stock);

    if (existing) {
      existing.quantity += qty;
    } else {
      cart.items.push({ variantId, size: sizeValue, quantity: qty });
    }

    await cart.save();
    return buildCartView(cart);
  });
};


const updateCartItem = async (userId, variantId, size, quantity) => {
  assertVariantId(variantId);
  const sizeValue = parseSize(size);
  const qty = parseQuantity(quantity);

  return withUserLock(userId, async () => {
    const cart = await Cart.findOne({ userId });
    const item = cart?.items.find((i) => sameLine(i, variantId, sizeValue));

    if (!item) {
      throw createError(MESSAGES.CART.ITEM_NOT_FOUND_IN_CART, STATUS.NOT_FOUND, ERROR_CODES.CART_ITEM_NOT_FOUND);
    }

    assertWithinLimit(qty);

    if (qty > item.quantity) {
      const { stock } = await loadPurchasable(variantId, sizeValue);
      assertQuantityAllowed(qty, stock);
    }

    item.quantity = qty;
    await cart.save();
    return buildCartView(cart);
  });
};


const removeCartItem = async (userId, variantId, size) => {
  assertVariantId(variantId);
  const sizeValue = parseSize(size);

  return withUserLock(userId, async () => {
    const cart = await Cart.findOne({ userId });
    const index = cart ? cart.items.findIndex((i) => sameLine(i, variantId, sizeValue)) : -1;

    if (index === -1) {
      throw createError(MESSAGES.CART.ITEM_NOT_FOUND_IN_CART, STATUS.NOT_FOUND, ERROR_CODES.CART_ITEM_NOT_FOUND);
    }

    cart.items.splice(index, 1);
    await cart.save();
    return buildCartView(cart);
  });
};


const clearCart = async (userId) =>
  withUserLock(userId, async () => {
    const cart = await Cart.findOneAndUpdate(
      { userId },
      { $set: { items: [] } },
      { new: true }
    );
    return buildCartView(cart);
  });

module.exports = {
  MAX_QUANTITY_PER_ITEM,
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
