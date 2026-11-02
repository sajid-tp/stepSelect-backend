// src/services/user/wishlistService.js
const Wishlist = require('../../models/wishlist');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const { getOfferMap, resolveDiscount } = require('./offerService');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

// Internal Helper: check variantId and size, return the cleaned size
const validateWishlistInput = (variantId, size) => {
  if (!variantId || !/^[0-9a-fA-F]{24}$/.test(variantId)) {
    throw createError(MESSAGES.VARIANT.INVALID_VARIANT_ID, STATUS.BAD_REQUEST);
  }

  if (!size || !String(size).trim()) {
    throw createError(MESSAGES.CART.SIZE_IS_REQUIRED, STATUS.BAD_REQUEST);
  }

  return String(size).trim();
};

// Internal Helper: a category / brand / product / variant is visible to shoppers
// only if it is active and not deleted
const isVisible = (doc) => {
  return Boolean(doc && doc.isActive && !doc.deletedAt);
};

// Internal Helper: price after discount (the percent comes from the offer engine)
const getFinalPrice = (variant, discountPercent) => {
  const price = Number(variant.price) || 0;
  const discount = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  return Math.round(price - (price * discount) / 100);
};

// Internal Helper: page and limit with safe defaults
const getPaging = (paging) => {
  const page = Math.max(parseInt(paging?.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(paging?.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit };
};

// Internal Helper: a variant + size can be wishlisted only if shoppers can currently see it.
// Same visibility rules as the product pages, so blocked products stay hidden (404).
// Stock is NOT checked: people can save an out-of-stock size and wait for it.
const assertWishlistable = async (variantId, size) => {
  const variant = await Variant.findOne({ _id: variantId, isActive: true, deletedAt: null });
  if (!variant) {
    throw createError(MESSAGES.VARIANT.VARIANT_NOT_FOUND, STATUS.NOT_FOUND);
  }

  const product = await Product.findOne({ _id: variant.productId, isActive: true, deletedAt: null });
  if (!product) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_IS_CURRENTLY_UNAVAILABLE, STATUS.NOT_FOUND);
  }

  const category = await Category.findById(product.categoryId);
  const brand = await Brand.findById(product.brandId);
  if (!isVisible(category) || !isVisible(brand)) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_NOT_FOUND, STATUS.NOT_FOUND);
  }

  const sizeEntry = variant.sizes.find((s) => String(s.size) === size);
  if (!sizeEntry) {
    throw createError(MESSAGES.CART.SELECTED_SIZE_IS_NOT_AVAILABLE, STATUS.BAD_REQUEST);
  }
};

// Internal Helper: build the response for GET /api/wishlist (newest first, paginated).
// Items that became unavailable after being saved are still returned,
// flagged with isAvailable:false, so the user can see and remove them.
const buildWishlistView = async (wishlist, paging) => {
  const { page, limit } = getPaging(paging);

  // Newest first
  const allItems = wishlist ? [...wishlist.items].reverse() : [];
  const totalItems = allItems.length;

  const view = {
    id: wishlist ? String(wishlist._id) : null,
    items: [],
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };

  const pageItems = allItems.slice((page - 1) * limit, page * limit);
  if (pageItems.length === 0) return view;

  // No isActive filter here on purpose: we want to see (and flag) inactive ones too
  const variants = await Variant.find({ _id: { $in: pageItems.map((item) => item.variantId) } });
  const products = await Product.find({ _id: { $in: variants.map((v) => v.productId) } });
  const brands = await Brand.find({ _id: { $in: products.map((p) => p.brandId) } });
  const categories = await Category.find({ _id: { $in: products.map((p) => p.categoryId) } });
  const offerMap = await getOfferMap(products.map((p) => ({ productId: p._id, categoryId: p.categoryId })));

  for (const item of pageItems) {
    const variant = variants.find((v) => String(v._id) === String(item.variantId));
    const product = variant
      ? products.find((p) => String(p._id) === String(variant.productId))
      : null;
    const brand = product
      ? brands.find((b) => String(b._id) === String(product.brandId))
      : null;
    const category = product
      ? categories.find((c) => String(c._id) === String(product.categoryId))
      : null;

    // Stock of the saved size
    const sizeEntry = variant
      ? variant.sizes.find((s) => String(s.size) === item.size)
      : null;
    const stock = sizeEntry ? sizeEntry.stock || 0 : 0;

    const isAvailable =
      isVisible(variant) &&
      isVisible(product) &&
      isVisible(brand) &&
      isVisible(category) &&
      Boolean(sizeEntry);

    let issue = null;
    if (!isAvailable) issue = 'UNAVAILABLE';
    else if (stock < 1) issue = 'OUT_OF_STOCK';

    // First image (can be a plain string or an object with url)
    let image = null;
    if (variant && variant.images && variant.images.length > 0) {
      const first = variant.images[0];
      image = typeof first === 'string' ? first : first.url || null;
    }

    const { discountPercent, offer } = resolveDiscount(
      product ? offerMap.get(String(product._id)) : null,
      variant ? variant.discountPercent : 0
    );

    view.items.push({
      productId: variant ? String(variant.productId) : null,
      variantId: String(item.variantId),
      name: product ? product.productName : null,
      brand: brand ? { id: String(brand._id), name: brand.brandName } : null,
      color: variant ? variant.color : null,
      size: item.size,
      image,
      price: variant ? Number(variant.price) || 0 : null,
      discountPercent,
      offer,
      finalPrice: variant ? getFinalPrice(variant, discountPercent) : null,
      stock,
      inStock: isAvailable && stock > 0,
      isAvailable,
      issue,
      addedAt: item.addedAt,
    });
  }

  return view;
};

// 1. Get Wishlist
const getWishlist = async (userId, paging) => {
  const wishlist = await Wishlist.findOne({ userId });
  return await buildWishlistView(wishlist, paging);
};

// 2. Get Wishlist Ids
// Lightweight list of saved variant + size pairs (with productId), so product
// cards / the product page can show a filled heart without loading everything.
const getWishlistIds = async (userId) => {
  const wishlist = await Wishlist.findOne({ userId });
  if (!wishlist || wishlist.items.length === 0) return { items: [] };

  const variantIds = wishlist.items.map((item) => item.variantId);
  const variants = await Variant.find({ _id: { $in: variantIds } });

  const items = wishlist.items.map((item) => {
    const variant = variants.find((v) => String(v._id) === String(item.variantId));

    return {
      productId: variant ? String(variant.productId) : null,
      variantId: String(item.variantId),
      size: item.size,
    };
  });

  return { items };
};

// 3. Add To Wishlist
// Adding is idempotent: saving the same colour + size twice is not an error.
// Both writes are atomic, so double clicks / parallel requests cannot create duplicates.
const addToWishlist = async (userId, { variantId, size }) => {
  const sizeValue = validateWishlistInput(variantId, size);
  await assertWishlistable(variantId, sizeValue);

  // Make sure the user's wishlist document exists
  try {
    await Wishlist.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
  } catch (err) {
    // Two requests created it at the same moment - the document exists, which is all we need
    if (err.code !== 11000) throw err;
  }

  // Push only if this variant + size is not already in the list
  const updated = await Wishlist.findOneAndUpdate(
    { userId, items: { $not: { $elemMatch: { variantId, size: sizeValue } } } },
    { $push: { items: { variantId, size: sizeValue, addedAt: new Date() } } },
    { new: true }
  );

  if (updated) {
    return { added: true, variantId, size: sizeValue, inWishlist: true, totalItems: updated.items.length };
  }

  // Already in the wishlist: nothing was added
  const current = await Wishlist.findOne({ userId });
  return {
    added: false,
    variantId,
    size: sizeValue,
    inWishlist: true,
    totalItems: current ? current.items.length : 0,
  };
};

// 4. Remove From Wishlist
const removeFromWishlist = async (userId, variantId, size) => {
  const sizeValue = validateWishlistInput(variantId, size);

  const updated = await Wishlist.findOneAndUpdate(
    { userId, items: { $elemMatch: { variantId, size: sizeValue } } },
    { $pull: { items: { variantId, size: sizeValue } } },
    { new: true }
  );

  if (!updated) {
    throw createError(MESSAGES.WISHLIST.ITEM_NOT_FOUND_IN_WISHLIST, STATUS.NOT_FOUND);
  }

  return { variantId, size: sizeValue, inWishlist: false, totalItems: updated.items.length };
};

// 5. Clear Wishlist
const clearWishlist = async (userId) => {
  await Wishlist.updateOne({ userId }, { $set: { items: [] } });
  return { totalItems: 0 };
};

module.exports = {
  getWishlist,
  getWishlistIds,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
};