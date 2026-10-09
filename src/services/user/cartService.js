const Cart = require('../../models/cart');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const createError = require('../../utils/createError');

// Max units of the SAME variant + size a user can hold in the cart.
const MAX_QUANTITY_PER_ITEM = 5;

/* ----------------------------- helpers ----------------------------- */

const isObjectId = (value) =>
  typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);

const assertVariantId = (variantId) => {
  if (!isObjectId(variantId)) {
    throw createError('Invalid variant id.', 400, 'INVALID_VARIANT_ID');
  }
};

const parseSize = (size) => {
  const value =
    typeof size === 'string' || typeof size === 'number' ? String(size).trim() : '';
  if (!value) throw createError('Size is required.', 400, 'SIZE_REQUIRED');
  return value;
};

// Accepts 3 or "3". Rejects 0, -1, 1.5, true, [2], null, "abc".
const parseQuantity = (quantity) => {
  const isNumeric =
    typeof quantity === 'number' ||
    (typeof quantity === 'string' && /^\d+$/.test(quantity.trim()));
  const qty = isNumeric ? Number(quantity) : NaN;

  if (!Number.isInteger(qty) || qty < 1) {
    throw createError('Quantity must be a whole number of at least 1.', 400, 'INVALID_QUANTITY');
  }
  return qty;
};

const assertWithinLimit = (total) => {
  if (total > MAX_QUANTITY_PER_ITEM) {
    throw createError(
      `You can buy at most ${MAX_QUANTITY_PER_ITEM} of the same item.`,
      400,
      'MAX_QUANTITY_EXCEEDED'
    );
  }
};

// `total` is the quantity the cart line would have AFTER the change.
const assertQuantityAllowed = (total, stock) => {
  assertWithinLimit(total);
  if (stock < 1) {
    throw createError('This size is out of stock.', 409, 'OUT_OF_STOCK');
  }
  if (total > stock) {
    throw createError(`Only ${stock} left in stock for this size.`, 409, 'INSUFFICIENT_STOCK');
  }
};

// Same formula as the product card, so the cart price always matches the shop.
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

/*
  Runs cart changes of ONE user one after another.
  Two quick clicks (or two tabs) can no longer read the same cart,
  both change it, and overwrite each other.
  (In-process lock: fine for one server instance.)
*/
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

// A variant can be added only if it, its product and the chosen size exist.
const loadPurchasable = async (variantId, size) => {
  const variant = await Variant.findOne({
    _id: variantId,
    isActive: true,
    deletedAt: null,
  })
    .select('productId sizes')
    .lean();

  if (!variant) {
    throw createError('Product variant not found.', 404, 'VARIANT_NOT_FOUND');
  }

  const product = await Product.findOne({
    _id: variant.productId,
    isActive: true,
    deletedAt: null,
  })
    .select('_id')
    .lean();

  if (!product) {
    throw createError('Product is currently unavailable.', 404, 'PRODUCT_UNAVAILABLE');
  }

  const sizeEntry = (variant.sizes || []).find((s) => String(s.size) === size);
  if (!sizeEntry) {
    throw createError('Selected size is not available.', 400, 'INVALID_SIZE');
  }

  return { variant, stock: sizeEntry.stock || 0 };
};

/*
  Turns the stored cart (ids + size + quantity) into the response shape,
  reading current price / name / image / stock from the database.

  Every cart endpoint returns THIS shape as `data`:
  {
    id, totalPrice, totalItems, maxQuantityPerItem,
    items: [{
      productId, variantId, name, color, size, image,
      price, quantity, lineTotal,
      stock, maxQuantity, isAvailable,
      issue            // null | UNAVAILABLE | OUT_OF_STOCK | INSUFFICIENT_STOCK
    }]
  }
  totalPrice only counts items that are available.
*/
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

/* ----------------------------- services ---------------------------- */

// 1. Get cart
const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId });
  return buildCartView(cart);
};

// 2. Add item (if the same variant + size is already there, quantity is added up)
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

/*
  3. Update quantity (sets the quantity, it does not add to it)
  Lowering a quantity is always allowed, even when stock dropped below it,
  so the customer can step down to what is still available.
  Raising it checks the limit and the current stock.
*/
const updateCartItem = async (userId, variantId, size, quantity) => {
  assertVariantId(variantId);
  const sizeValue = parseSize(size);
  const qty = parseQuantity(quantity);

  return withUserLock(userId, async () => {
    const cart = await Cart.findOne({ userId });
    const item = cart?.items.find((i) => sameLine(i, variantId, sizeValue));

    if (!item) {
      throw createError('Item not found in cart.', 404, 'CART_ITEM_NOT_FOUND');
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

// 4. Remove one item
const removeCartItem = async (userId, variantId, size) => {
  assertVariantId(variantId);
  const sizeValue = parseSize(size);

  return withUserLock(userId, async () => {
    const cart = await Cart.findOne({ userId });
    const index = cart ? cart.items.findIndex((i) => sameLine(i, variantId, sizeValue)) : -1;

    if (index === -1) {
      throw createError('Item not found in cart.', 404, 'CART_ITEM_NOT_FOUND');
    }

    cart.items.splice(index, 1);
    await cart.save();
    return buildCartView(cart);
  });
};

// 5. Clear the whole cart (the cart document stays, only its items are emptied)
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
