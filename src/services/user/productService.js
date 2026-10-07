const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');

const mongoose = require('mongoose');


// -----------------------------------------
// Error helper
// -----------------------------------------

const createError = (
  message,
  statusCode = 400,
  code = 'BAD_REQUEST'
) => {

  const error = new Error(message);

  error.statusCode = statusCode;
  error.code = code;

  return error;
};


// -----------------------------------------
// Escape regex
// -----------------------------------------

const escapeRegex = (value) => {

  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

};


// -----------------------------------------
// GET PRODUCTS
// -----------------------------------------

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

  const pageNum = Number(page);
  const limitNum = Number(limit);


  // -----------------------------------------
  // Validate page
  // -----------------------------------------

  if (!Number.isInteger(pageNum) || pageNum < 1) {

    throw createError(
      'Page must be greater than 0.',
      400,
      'INVALID_PAGE'
    );

  }


  // -----------------------------------------
  // Validate limit
  // -----------------------------------------

  if (!Number.isInteger(limitNum) || limitNum < 1) {

    throw createError(
      'Limit must be greater than 0.',
      400,
      'INVALID_LIMIT'
    );

  }


  // -----------------------------------------
  // Validate price
  // -----------------------------------------

  let minPriceNum;
  let maxPriceNum;


  if (
    minPrice !== undefined &&
    minPrice !== ''
  ) {

    minPriceNum = Number(minPrice);

    if (
      Number.isNaN(minPriceNum) ||
      minPriceNum < 0
    ) {

      throw createError(
        'Invalid minimum price.',
        400,
        'INVALID_MIN_PRICE'
      );

    }

  }


  if (
    maxPrice !== undefined &&
    maxPrice !== ''
  ) {

    maxPriceNum = Number(maxPrice);

    if (
      Number.isNaN(maxPriceNum) ||
      maxPriceNum < 0
    ) {

      throw createError(
        'Invalid maximum price.',
        400,
        'INVALID_MAX_PRICE'
      );

    }

  }


  if (
    minPriceNum !== undefined &&
    maxPriceNum !== undefined &&
    minPriceNum > maxPriceNum
  ) {

    throw createError(
      'Minimum price cannot be greater than maximum price.',
      400,
      'INVALID_PRICE_RANGE'
    );

  }


  // -----------------------------------------
  // Validate sort
  // -----------------------------------------

  const allowedSorts = [
    'newest',
    'price_asc',
    'price_desc',
    'name_asc',
    'name_desc',
  ];


  const sortValue = sort || 'newest';


  if (!allowedSorts.includes(sortValue)) {

    throw createError(
      'Invalid sort option.',
      400,
      'INVALID_SORT'
    );

  }


  // -----------------------------------------
  // Product filter
  // -----------------------------------------

  const productFilter = {
    deletedAt: null,
    isActive: true,
  };


  // -----------------------------------------
  // Search
  // -----------------------------------------

  if (search && search.trim()) {

    const escapedSearch = escapeRegex(
      search.trim()
    );

    productFilter.productName = {
      $regex: escapedSearch,
      $options: 'i',
    };

  }


  // -----------------------------------------
  // Category
  // -----------------------------------------

  if (category && category.trim()) {

    const categoryValue = category.trim();

    const categoryRegex = new RegExp(
      `^${escapeRegex(
        categoryValue.replace(/-/g, ' ')
      )}$`,
      'i'
    );


    const categoryDoc = await Category.findOne({
      deletedAt: null,
      isActive: true,
      $or: [
        {
          slug: categoryValue,
        },
        {
          categoryName: categoryRegex,
        },
      ],
    }).select('_id');


    if (!categoryDoc) {

      return {
        products: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalResults: 0,
          totalPages: 0,
        },
      };

    }


    productFilter.categoryId = categoryDoc._id;

  }


  // -----------------------------------------
  // Brand
  // -----------------------------------------

  if (brand && brand.trim()) {

    const brandValue = brand.trim();

    const brandDoc = await Brand.findOne({
      deletedAt: null,
      isActive: true,
      $or: [
        {
          slug: brandValue,
        },
        {
          brandName: new RegExp(
            `^${escapeRegex(
              brandValue.replace(/-/g, ' ')
            )}$`,
            'i'
          ),
        },
      ],
    }).select('_id');


    if (!brandDoc) {

      return {
        products: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalResults: 0,
          totalPages: 0,
        },
      };

    }


    productFilter.brandId = brandDoc._id;

  }


  // -----------------------------------------
  // Find products
  // -----------------------------------------

  const products = await Product.find(productFilter)
    .select(
      'productName brandId categoryId isActive createdAt updatedAt'
    )
    .lean();


  if (products.length === 0) {

    return {
      products: [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalResults: 0,
        totalPages: 0,
      },
    };

  }


  // -----------------------------------------
  // Get active variants
  // -----------------------------------------

  const productIds = products.map(
    product => product._id
  );


  const variants = await Variant.find({
    productId: {
      $in: productIds,
    },
    isActive: true,
    deletedAt: null,
  })
    .select(
      'productId price images discountPercent'
    )
    .sort({
      price: 1,
    })
    .lean();


  // -----------------------------------------
  // Group variants by product
  // -----------------------------------------

  const variantMap = new Map();


  for (const variant of variants) {

    const productId =
      variant.productId.toString();


    if (!variantMap.has(productId)) {

      variantMap.set(
        productId,
        variant
      );

    }

  }


  // -----------------------------------------
  // Build product data
  // -----------------------------------------

  let productData = products
    .map(product => {

      const variant =
        variantMap.get(
          product._id.toString()
        );


      // Product must have at least
      // one active variant.

      if (!variant) {
        return null;
      }


      return {

        id: product._id,

        name: product.productName,

        brandId: product.brandId,

        categoryId: product.categoryId,

        price: variant.price,

        discountPercent:
          variant.discountPercent || 0,

        images:
          variant.images || [],

        isActive:
          product.isActive,

        createdAt:
          product.createdAt,

      };

    })
    .filter(Boolean);


  // -----------------------------------------
  // Price filtering
  // -----------------------------------------

  if (
    minPriceNum !== undefined
  ) {

    productData = productData.filter(
      product =>
        product.price >= minPriceNum
    );

  }


  if (
    maxPriceNum !== undefined
  ) {

    productData = productData.filter(
      product =>
        product.price <= maxPriceNum
    );

  }


  // -----------------------------------------
  // Sorting
  // -----------------------------------------

  switch (sortValue) {

    case 'price_asc':

      productData.sort(
        (a, b) =>
          a.price - b.price
      );

      break;


    case 'price_desc':

      productData.sort(
        (a, b) =>
          b.price - a.price
      );

      break;


    case 'name_asc':

      productData.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

      break;


    case 'name_desc':

      productData.sort(
        (a, b) =>
          b.name.localeCompare(
            a.name
          )
      );

      break;


    case 'newest':
    default:

      productData.sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

      break;

  }


  // -----------------------------------------
  // Pagination
  // -----------------------------------------

  const totalResults =
    productData.length;


  const totalPages =
    Math.ceil(
      totalResults / limitNum
    );


  const skip =
    (pageNum - 1) * limitNum;


  const paginatedProducts =
    productData.slice(
      skip,
      skip + limitNum
    );


  // -----------------------------------------
  // Return
  // -----------------------------------------

  return {

    products:
      paginatedProducts.map(
        product => ({

          id: product.id,

          name: product.name,

          brandId:
            product.brandId,

          categoryId:
            product.categoryId,

          price:
            product.price,

          discountPercent:
            product.discountPercent,

          images:
            product.images,

          isActive:
            product.isActive,

        })
      ),

    pagination: {

      page: pageNum,

      limit: limitNum,

      totalResults,

      totalPages,

    },

  };

};


// -----------------------------------------
// GET PRODUCT DETAILS
// -----------------------------------------

const getProduct = async (
  productId
) => {

  // -----------------------------------------
  // Validate product ID
  // -----------------------------------------

  if (
    !mongoose.Types.ObjectId.isValid(
      productId
    )
  ) {

    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );

  }


  // -----------------------------------------
  // Get product
  // -----------------------------------------

  const product =
    await Product.findOne({

      _id: productId,

      deletedAt: null,

      isActive: true,

    })
      .populate(
        'brandId',
        'brandName slug logo'
      )
      .populate(
        'categoryId',
        'categoryName iconClass'
      )
      .lean();


  if (!product) {

    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );

  }


  // -----------------------------------------
  // Get active variants
  // -----------------------------------------

  const variants =
    await Variant.find({

      productId:
        product._id,

      deletedAt: null,

      isActive: true,

    })
      .select(
        'color price images sizes discountPercent'
      )
      .lean();


  if (variants.length === 0) {

    throw createError(
      'Product is currently unavailable.',
      404,
      'PRODUCT_UNAVAILABLE'
    );

  }


  // -----------------------------------------
  // Collect product images
  // -----------------------------------------

  const imageSet = new Set();


  for (const variant of variants) {

    for (
      const image of variant.images || []
    ) {

      imageSet.add(image);

    }

  }


  const images =
    Array.from(imageSet);


  // -----------------------------------------
  // Flatten sizes
  // -----------------------------------------

  const variantData = [];


  for (const variant of variants) {

    for (
      const sizeItem of variant.sizes || []
    ) {

      variantData.push({

        id: variant._id,

        color: variant.color,

        size: sizeItem.size,

        price: variant.price,

        quantity: sizeItem.stock,

      });

    }

  }


  // -----------------------------------------
  // Return
  // -----------------------------------------

  return {

    id: product._id,

    name: product.productName,

    description: product.description,

    brand: {

      id: product.brandId?._id,

      name:
        product.brandId?.brandName,

    },

    category: {

      id: product.categoryId?._id,

      categoryName:
        product.categoryId?.categoryName,

    },

    images,

    variants: variantData,

  };

};


module.exports = {

  getProducts,

  getProduct,

};