const mongoose = require('mongoose');
const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');

const createError = (message, statusCode = 400, code = 'BAD_REQUEST') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(value);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1. Get Paginated & Filtered Products
const getProducts = async ({
  search,
  category,
  brand,
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

  // Validate price
  let minPriceNum;
  let maxPriceNum;

  if (minPrice !== undefined && minPrice !== '') {
    minPriceNum = Number(minPrice);
    if (!Number.isFinite(minPriceNum) || minPriceNum < 0) {
      throw createError('Invalid minimum price.', 400, 'INVALID_MIN_PRICE');
    }
  }

  if (maxPrice !== undefined && maxPrice !== '') {
    maxPriceNum = Number(maxPrice);
    if (!Number.isFinite(maxPriceNum) || maxPriceNum < 0) {
      throw createError('Invalid maximum price.', 400, 'INVALID_MAX_PRICE');
    }
  }

  if (minPriceNum !== undefined && maxPriceNum !== undefined && minPriceNum > maxPriceNum) {
    throw createError(
      'Minimum price cannot be greater than maximum price.',
      400,
      'INVALID_PRICE_RANGE'
    );
  }

  // Validate sort
  const sortOptions = {
    newest: { createdAt: -1, _id: -1 },
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: 1 },
    name_asc: { productName: 1, _id: 1 },
    name_desc: { productName: -1, _id: 1 },
  };

  const sortValue = sort || 'newest';

  if (!Object.hasOwn(sortOptions, sortValue)) {
    throw createError('Invalid sort option.', 400, 'INVALID_SORT');
  }

  // Product filter
  const filter = { isActive: true, deletedAt: null };

  // Search filtering
  if (typeof search === 'string' && search.trim()) {
    filter.productName = { $regex: escapeRegex(search.trim()), $options: 'i' };
  }

  // Category filtering (id or name)
  if (typeof category === 'string' && category.trim()) {
    const categoryValue = category.trim();

    if (isObjectId(categoryValue)) {
      // aggregate() does not auto-cast strings, so convert to ObjectId
      filter.categoryId = new mongoose.Types.ObjectId(categoryValue);
    } else {
      const categoryDoc = await Category.findOne({
        isActive: true,
        deletedAt: null,
        categoryName: new RegExp(`^${escapeRegex(categoryValue.replace(/-/g, ' '))}$`, 'i'),
      }).select('_id');

      if (!categoryDoc) return emptyResult;

      filter.categoryId = categoryDoc._id;
    }
  }

  // Brand filtering (id or name)
  if (typeof brand === 'string' && brand.trim()) {
    const brandValue = brand.trim();

    if (isObjectId(brandValue)) {
      filter.brandId = new mongoose.Types.ObjectId(brandValue);
    } else {
      const brandDoc = await Brand.findOne({
        isActive: true,
        deletedAt: null,
        brandName: new RegExp(`^${escapeRegex(brandValue.replace(/-/g, ' '))}$`, 'i'),
      }).select('_id');

      if (!brandDoc) return emptyResult;

      filter.brandId = brandDoc._id;
    }
  }

  // Price lives on variants, so we join the cheapest active variant
  // to each product, then filter / sort / paginate in the database.
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
    // products without an active variant are removed here
    { $unwind: '$variant' },
    { $addFields: { price: '$variant.price' } },
  ];

  // Price filtering
  const priceFilter = {};
  if (minPriceNum !== undefined) priceFilter.$gte = minPriceNum;
  if (maxPriceNum !== undefined) priceFilter.$lte = maxPriceNum;

  if (Object.keys(priceFilter).length > 0) {
    pipeline.push({ $match: { price: priceFilter } });
  }

  // Sort + paginate + count in one query
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

  return {
    products: result.items,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalResults,
      totalPages,
    },
  };
};

// 2. Get Product Details
const getProduct = async (productId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product id.', 400, 'INVALID_PRODUCT_ID');
  }

  const product = await Product.findOne({
    _id: productId,
    isActive: true,
    deletedAt: null,
  })
    .populate('brandId', 'brandName')
    .populate('categoryId', 'categoryName')
    .lean();

  if (!product) {
    throw createError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  }

  const variants = await Variant.find({
    productId: product._id,
    isActive: true,
    deletedAt: null,
  })
    .select('color price discountPercent images sizes')
    .lean();

  if (variants.length === 0) {
    throw createError('Product is currently unavailable.', 404, 'PRODUCT_UNAVAILABLE');
  }

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
    // one entry per color, each with its own images and sizes
    variants: variants.map((variant) => ({
      id: variant._id,
      color: variant.color,
      price: variant.price,
      discountPercent: variant.discountPercent || 0,
      images: variant.images || [],
      sizes: (variant.sizes || []).map((s) => ({
        size: s.size,
        quantity: s.stock,
      })),
    })),
  };
};


module.exports = {
  getProducts,
  getProduct,
};