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
  if (namePatterns.length > 0) {
    const docs = await Model.find({
      isActive: true,
      deletedAt: null,
      [nameField]: { $in: namePatterns },
    }).select('_id');

    ids.push(...docs.map((doc) => doc._id));
  }

  return ids;
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
      throw createError('Invalid minimum price.', 400, 'INVALID_MIN_PRICE');
    }
  }

  if (maxPrice !== undefined && maxPrice !== '') {    maxPriceNum = Number(maxPrice);
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
  const categoryIds = await resolveIds(category, Category, 'categoryName');

  if (categoryIds.length === 0) return emptyResult;

  filter.categoryId = { $in: categoryIds };
}

  // Brand filtering (id or name)
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




// Related products: same category, never the current product, in stock only.
const getRelatedProducts = async (productId, limit = 4) => {
  if (!/^[0-9a-fA-F]{24}$/.test(String(productId))) {
    throw createError('Invalid product id.', 400, 'INVALID_PRODUCT_ID');
  }

  const max = Math.min(Math.max(Number.parseInt(limit, 10) || 4, 1), 12);

  const current = await Product.findOne({
    _id: productId,
    isActive: true,
    deletedAt: null,
  })
    .select('categoryId')
    .lean();

  if (!current) {
    throw createError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  }

  const products = await Product.find({
    categoryId: current.categoryId,
    _id: { $ne: current._id },
    isActive: true,
    deletedAt: null,
  })
    .select('productName brandId')
    .populate('brandId', 'brandName')
    .sort({ createdAt: -1 })
    .limit(max * 3) // spare ones, in case some have nothing in stock
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

  // first in-stock variant per product (the same one the shop card's quick add uses)
  const firstVariant = new Map();
  variants.forEach((v) => {
    if (!firstVariant.has(String(v.productId))) firstVariant.set(String(v.productId), v);
  });

  return {
    products: products
      .filter((p) => firstVariant.has(String(p._id)))
      .slice(0, max)
      .map((p) => {
        const v = firstVariant.get(String(p._id));
        return {
          id: String(p._id),
          name: p.productName,
          brand: p.brandId ? { id: String(p.brandId._id), name: p.brandId.name } : null,
          images: (v.images || [])
            .map((image) => (typeof image === 'string' ? image : image?.url))
            .filter(Boolean),
          price: Number(v.price) || 0,
          discountPercent: Number(v.discountPercent) || 0,
        };
      }),
  };
};


module.exports = {
  getProducts,
  getProduct,
};