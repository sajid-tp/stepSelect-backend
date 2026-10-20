// src/services/admin/adminInventoryServices.js
const Variant = require('../../models/variants');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { LOW_STOCK_LIMIT } = require('../../constants/orderConstants');
const { isObjectId, escapeRegex, firstImage } = require('../../utils/orderHelpers');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// out_of_stock: nothing left | low_stock: on average LOW_STOCK_LIMIT or fewer pairs per size | in_stock
const getStockStatus = (sizes) => {
  const total = sizes.reduce((sum, s) => sum + (s.stock || 0), 0);
  if (total === 0) return 'out_of_stock';
  if (total <= LOW_STOCK_LIMIT * sizes.length) return 'low_stock';
  return 'in_stock';
};

const toRow = (variant, product) => ({
  variantId: String(variant._id),
  productId: String(variant.productId),
  productName: product ? product.productName : null,
  color: variant.color,
  image: firstImage(variant.images),
  price: variant.price,
  isActive: variant.isActive,
  sizes: variant.sizes.map((s) => ({
    size: s.size,
    stock: s.stock,
    isLow: s.stock > 0 && s.stock <= LOW_STOCK_LIMIT,
    isOut: s.stock === 0,
  })),
  totalStock: variant.sizes.reduce((sum, s) => sum + (s.stock || 0), 0),
  stockStatus: getStockStatus(variant.sizes),
  updatedAt: variant.updatedAt,
});

// 1. Inventory list: one row per product colour, with stock per size
const getInventory = async ({ search, stockFilter, sort, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const text = search ? String(search).trim() : '';
  const regex = text ? new RegExp(escapeRegex(text), 'i') : null;

  const pipeline = [
    { $match: { deletedAt: null } },
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $match: { 'product.deletedAt': null } },
    ...(regex ? [{ $match: { $or: [{ 'product.productName': regex }, { color: regex }] } }] : []),
    {
      $addFields: {
        totalStock: { $sum: '$sizes.stock' },
        sizeCount: { $size: '$sizes' },
      },
    },
  ];

  if (stockFilter === 'out') {
    pipeline.push({ $match: { totalStock: 0 } });
  } else if (stockFilter === 'low') {
    pipeline.push({
      $match: { $expr: { $and: [{ $gt: ['$totalStock', 0] }, { $lte: ['$totalStock', { $multiply: [LOW_STOCK_LIMIT, '$sizeCount'] }] }] } },
    });
  } else if (stockFilter === 'in') {
    pipeline.push({ $match: { $expr: { $gt: ['$totalStock', { $multiply: [LOW_STOCK_LIMIT, '$sizeCount'] }] } } });
  }

  const sorts = {
    stock_asc: { totalStock: 1, _id: 1 },
    stock_desc: { totalStock: -1, _id: 1 },
    name: { 'product.productName': 1, color: 1 },
    newest: { updatedAt: -1 },
  };
  pipeline.push({ $sort: sorts[sort] || sorts.newest });

  pipeline.push({
    $facet: {
      rows: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
      total: [{ $count: 'count' }],
    },
  });

  const [result] = await Variant.aggregate(pipeline);
  const totalItems = result.total[0] ? result.total[0].count : 0;

  return {
    items: result.rows.map((row) => toRow(row, row.product)),
    lowStockLimit: LOW_STOCK_LIMIT,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

// 2. Change the stock of one size. Send { size, stock } to set an exact number,
//    or { size, adjust } to add / remove (safe while customers are buying).
const updateStock = async (variantId, { size, stock, adjust } = {}) => {
  if (!isObjectId(variantId)) {
    throw createError(MESSAGES.VARIANT.INVALID_VARIANT_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_VARIANT_ID);
  }
  if (!size || !String(size).trim()) {
    throw createError(MESSAGES.CART.SIZE_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.SIZE_REQUIRED);
  }
  const sizeValue = String(size).trim();

  let updated;
  if (adjust !== undefined && adjust !== null && adjust !== '') {
    const delta = Number(adjust);
    if (!Number.isInteger(delta)) {
      throw createError(MESSAGES.INVENTORY.INVALID_STOCK_VALUE, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_STOCK);
    }
    // The $gte check stops the stock from going below 0 even if someone buys at the same moment
    updated = await Variant.findOneAndUpdate(
      { _id: variantId, deletedAt: null, sizes: { $elemMatch: { size: sizeValue, stock: { $gte: delta < 0 ? -delta : 0 } } } },
      { $inc: { 'sizes.$.stock': delta } },
      { new: true }
    );
  } else {
    const value = Number(stock);
    if (stock === undefined || stock === null || stock === '' || !Number.isInteger(value) || value < 0) {
      throw createError(MESSAGES.INVENTORY.INVALID_STOCK_VALUE, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_STOCK);
    }
    updated = await Variant.findOneAndUpdate(
      { _id: variantId, deletedAt: null, 'sizes.size': sizeValue },
      { $set: { 'sizes.$.stock': value } },
      { new: true }
    );
  }

  if (!updated) {
    // Work out which problem it was, for a clear message
    const exists = await Variant.findOne({ _id: variantId, deletedAt: null });
    if (!exists) {
      throw createError(MESSAGES.VARIANT.VARIANT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.VARIANT_NOT_FOUND);
    }
    if (!exists.sizes.some((s) => String(s.size) === sizeValue)) {
      throw createError(MESSAGES.INVENTORY.SIZE_NOT_FOUND_FOR_VARIANT, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_SIZE);
    }
    throw createError(MESSAGES.INVENTORY.INVALID_STOCK_VALUE, STATUS.CONFLICT, ERROR_CODES.INVALID_STOCK);
  }

  return toRow(updated, null);
};

module.exports = { getInventory, updateStock };
