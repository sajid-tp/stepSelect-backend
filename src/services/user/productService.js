const mongoose = require('mongoose');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { getOfferMap, resolveDiscount } = require('./offerService');

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(value);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A category/brand is visible to shoppers only if it is active and not deleted.
const isVisible = (doc) => Boolean(doc && doc.isActive && !doc.deletedAt);

// Ids of every active (non-blocked, non-deleted) document of a model.
const getActiveIds = (Model) =>
  Model.find({ isActive: true, deletedAt: null }).distinct('_id');

// Resolves a comma separated list of ids and/or names into ids,
// keeping ONLY documents that are active and not deleted.
const resolveIds = async (rawValue, Model, nameField) => {
  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const ids = [];
  const namePatterns = [];

  for (const value of values) {
    if (isObjectId(value)) {
      ids.push(new mongoose.Types.ObjectId(value));
    } else {
      namePatterns.push(
        new RegExp(`^${escapeRegex(value.replace(/-/g, ' '))}$`, 'i')
      );
    }
  }

  const or = [];
  if (ids.length > 0) or.push({ _id: { $in: ids } });
  if (namePatterns.length > 0) or.push({ [nameField]: { $in: namePatterns } });
  if (or.length === 0) return [];

  const docs = await Model.find({
    isActive: true,
    deletedAt: null,
    $or: or,
  }).select('_id');

  return docs.map((doc) => doc._id);
};

const getProducts = async ({
  search,
  category,
  brand,
  gender,
  minPrice,
  maxPrice,
  sort = 'newest',
  page = 1,
  limit = 12,
}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);

  const emptyResult = {
    products: [],
    pagination: { page: pageNum, limit: limitNum, totalResults: 0, totalPages: 0 },
  };

  let minPriceNum;
  let maxPriceNum;

  if (minPrice !== undefined && minPrice !== '') {
    minPriceNum = Number(minPrice);
    if (!Number.isFinite(minPriceNum) || minPriceNum < 0) {
      throw createError(MESSAGES.PRODUCT.INVALID_MINIMUM_PRICE, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_MIN_PRICE);
    }
  }

  if (maxPrice !== undefined && maxPrice !== '') {
    maxPriceNum = Number(maxPrice);
    if (!Number.isFinite(maxPriceNum) || maxPriceNum < 0) {
      throw createError(MESSAGES.PRODUCT.INVALID_MAXIMUM_PRICE, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_MAX_PRICE);
    }
  }

  if (minPriceNum !== undefined && maxPriceNum !== undefined && minPriceNum > maxPriceNum) {
    throw createError(
      MESSAGES.PRODUCT.MINIMUM_PRICE_CANNOT_BE_GREATER_THAN_MAXIMUM_PRICE,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRICE_RANGE
    );
  }

  const sortOptions = {
    newest: { createdAt: -1, _id: -1 },
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: 1 },
    name_asc: { productName: 1, _id: 1 },
    name_desc: { productName: -1, _id: 1 },
  };

  const sortValue = sort || 'newest';

  if (!Object.hasOwn(sortOptions, sortValue)) {
    throw createError(MESSAGES.PRODUCT.INVALID_SORT_OPTION, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_SORT);
  }

  const filter = { isActive: true, deletedAt: null };

  // Always restrict to products whose category AND brand are active.
  // If a category/brand query param is given below, it overwrites these
  // with ids that have already been validated as active.
  const [activeCategoryIds, activeBrandIds] = await Promise.all([
    getActiveIds(Category),
    getActiveIds(Brand),
  ]);

  filter.categoryId = { $in: activeCategoryIds };
  filter.brandId = { $in: activeBrandIds };

  if (typeof search === 'string' && search.trim()) {
    filter.productName = { $regex: escapeRegex(search.trim()), $options: 'i' };
  }

  if (typeof category === 'string' && category.trim()) {
    const categoryIds = await resolveIds(category, Category, 'categoryName');

    if (categoryIds.length === 0) return emptyResult;

    filter.categoryId = { $in: categoryIds };
  }

  if (typeof brand === 'string' && brand.trim()) {
    const brandIds = await resolveIds(brand, Brand, 'brandName');

    if (brandIds.length === 0) return emptyResult;

    filter.brandId = { $in: brandIds };
  }

  if (gender) {
    const normalized = gender.trim().toLowerCase();

    if (['men', 'women', 'unisex'].includes(normalized)) {
      filter.gender =
        normalized === 'unisex'
          ? 'unisex'
          : { $in: [normalized, 'unisex'] };
    }
  }

  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: Variant.collection.name,
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$productId', '$$productId'] },
              isActive: true,
              deletedAt: null,
            },
          },
          { $sort: { price: 1 } },
          { $limit: 1 },
          { $project: { price: 1, images: 1, discountPercent: 1 } },
        ],
        as: 'variant',
      },
    },

    { $unwind: '$variant' },
    { $addFields: { price: '$variant.price' } },
  ];

  const priceFilter = {};
  if (minPriceNum !== undefined) priceFilter.$gte = minPriceNum;
  if (maxPriceNum !== undefined) priceFilter.$lte = maxPriceNum;

  if (Object.keys(priceFilter).length > 0) {
    pipeline.push({ $match: { price: priceFilter } });
  }

  pipeline.push(
    { $sort: sortOptions[sortValue] },
    {
      $facet: {
        items: [
          { $skip: (pageNum - 1) * limitNum },
          { $limit: limitNum },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: '$productName',
              brandId: 1,
              categoryId: 1,
              price: 1,
              discountPercent: { $ifNull: ['$variant.discountPercent', 0] },
              images: { $ifNull: ['$variant.images', []] },
              isActive: 1,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    }
  );

  const [result] = await Product.aggregate(pipeline).collation({
    locale: 'en',
    strength: 2,
  });

  const totalResults = result.total[0]?.count || 0;
  const totalPages = Math.ceil(totalResults / limitNum);

  // Product / category offers: the shopper gets the larger of the two
  const offerMap = await getOfferMap(
    result.items.map((item) => ({ productId: item.id, categoryId: item.categoryId }))
  );
  const products = result.items.map((item) => {
    const { discountPercent, offer } = resolveDiscount(offerMap.get(String(item.id)), item.discountPercent);
    return { ...item, discountPercent, offer };
  });

  return {
    products,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalResults,
      totalPages,
    },
  };
};

const getProduct = async (productId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(MESSAGES.PRODUCT.INVALID_PRODUCT_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PRODUCT_ID);
  }

  const product = await Product.findOne({
    _id: productId,
    isActive: true,
    deletedAt: null,
  })
    .populate('brandId', 'brandName isActive deletedAt')
    .populate('categoryId', 'categoryName isActive deletedAt')
    .lean();

  if (!product) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_NOT_FOUND);
  }

  // Hide products whose category or brand is blocked/deleted.
  // 404 (not a "blocked" message) so we don't reveal the product exists.
  if (!isVisible(product.categoryId) || !isVisible(product.brandId)) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_NOT_FOUND);
  }

  const variants = await Variant.find({
    productId: product._id,
    isActive: true,
    deletedAt: null,
  })
    .select('color price discountPercent images sizes')
    .lean();

  if (variants.length === 0) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_IS_CURRENTLY_UNAVAILABLE, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_UNAVAILABLE);
  }

  const offerMap = await getOfferMap([{ productId: product._id, categoryId: product.categoryId?._id }]);
  const productOffer = offerMap.get(String(product._id)) || null;

  return {
    id: product._id,
    name: product.productName,
    description: product.description,
    brand: {
      id: product.brandId?._id,
      name: product.brandId?.brandName,
    },
    category: {
      id: product.categoryId?._id,
      categoryName: product.categoryId?.categoryName,
    },

    variants: variants.map((variant) => {
      const { discountPercent, offer } = resolveDiscount(productOffer, variant.discountPercent);
      return {
        id: variant._id,
        color: variant.color,
        price: variant.price,
        discountPercent,
        offer,
        images: variant.images || [],
        sizes: (variant.sizes || []).map((s) => ({
          size: s.size,
          quantity: s.stock,
        })),
      };
    }),
  };
};

const getRelatedProducts = async (productId, limit = 4) => {
  if (!isObjectId(String(productId))) {
    throw createError(MESSAGES.PRODUCT.INVALID_PRODUCT_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PRODUCT_ID);
  }

  const max = Math.min(Math.max(Number.parseInt(limit, 10) || 4, 1), 12);

  const current = await Product.findOne({
    _id: productId,
    isActive: true,
    deletedAt: null,
  })
    .select('categoryId brandId')
    .populate('categoryId', 'isActive deletedAt')
    .populate('brandId', 'isActive deletedAt')
    .lean();

  if (!current) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_NOT_FOUND);
  }

  // If the current product's category/brand is blocked, treat it as not found.
  if (!isVisible(current.categoryId) || !isVisible(current.brandId)) {
    throw createError(MESSAGES.PRODUCT.PRODUCT_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.PRODUCT_NOT_FOUND);
  }

  // Related products must also belong to an active brand.
  const activeBrandIds = await getActiveIds(Brand);

  const products = await Product.find({
    categoryId: current.categoryId._id,
    brandId: { $in: activeBrandIds },
    _id: { $ne: current._id },
    isActive: true,
    deletedAt: null,
  })
    .select('productName brandId')
    .populate('brandId', 'brandName')
    .sort({ createdAt: -1 })
    .limit(max * 3)
    .lean();

  const variants = await Variant.find({
    productId: { $in: products.map((p) => p._id) },
    isActive: true,
    deletedAt: null,
    sizes: { $elemMatch: { stock: { $gt: 0 } } },
  })
    .select('productId price discountPercent images')
    .sort({ createdAt: 1 })
    .lean();

  const firstVariant = new Map();
  variants.forEach((v) => {
    if (!firstVariant.has(String(v.productId))) firstVariant.set(String(v.productId), v);
  });

  // every related product is in the same category as the current one
  const offerMap = await getOfferMap(
    products.map((p) => ({ productId: p._id, categoryId: current.categoryId._id }))
  );

  return {
    products: products
      .filter((p) => firstVariant.has(String(p._id)))
      .slice(0, max)
      .map((p) => {
        const v = firstVariant.get(String(p._id));
        const { discountPercent, offer } = resolveDiscount(offerMap.get(String(p._id)), v.discountPercent);
        return {
          id: String(p._id),
          name: p.productName,
          // fixed: populated field is brandName, not name
          brand: p.brandId ? { id: String(p.brandId._id), name: p.brandId.brandName } : null,
          images: (v.images || [])
            .map((image) => (typeof image === 'string' ? image : image?.url))
            .filter(Boolean),
          price: Number(v.price) || 0,
          discountPercent,
          offer,
        };
      }),
  };
};

module.exports = {
  getProducts,
  getProduct,
  getRelatedProducts,
};
