const mongoose = require('mongoose');

const Variant = require('../../models/variants');
const Product = require('../../models/products');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getVariants = async (
  productId,
  { page = 1, limit = 5 }
) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
    );
  }


  const pageNum = Number(page);
  const limitNum = Number(limit);

  if (
    !Number.isInteger(pageNum) ||
    pageNum < 1
  ) {
    throw createError(
      MESSAGES.COMMON.PAGE_MUST_BE_GREATER_THAN_0,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PAGE
    );
  }

  if (
    !Number.isInteger(limitNum) ||
    limitNum < 1
  ) {
    throw createError(
      MESSAGES.COMMON.LIMIT_MUST_BE_GREATER_THAN_0,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_LIMIT
    );
  }

  const product = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
    );
  }

  const filter = {
    productId: product._id,
    deletedAt: null,
  };

  const skip = (pageNum - 1) * limitNum;

  const [variants, totalVariants] = await Promise.all([
    Variant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),

    Variant.countDocuments(filter),
  ]);

  const data = variants.map((variant) => ({
    id: variant._id,
    productId: variant.productId,
    color: variant.color,
    price: variant.price,
    images: variant.images,
    sizes: variant.sizes,
    isActive: variant.isActive,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  }));




  return {
    variants: data,

    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalVariants / limitNum),
      totalVariants,
      limit: limitNum,
    },
  };
};


// const getVariant = async (variantId) => {

//   if (!mongoose.Types.ObjectId.isValid(variantId)) {
//     throw createError(
//       MESSAGES.VARIANT.INVALID_VARIANT_ID,
//       STATUS.BAD_REQUEST,
//       ERROR_CODES.INVALID_VARIANT_ID
//     );
//   }


//   const variant = await Variant.findOne({
//     _id: variantId,
//     deletedAt: null,
//   });

//   if (!variant) {
//     throw createError(
//       MESSAGES.VARIANT.VARIANT_NOT_FOUND,
//       STATUS.NOT_FOUND,
//       ERROR_CODES.VARIANT_NOT_FOUND
//     );
//   }

//   const product = await Product.findOne({
//     _id: variant.productId,
//     deletedAt: null,
//   });

//   if (!product) {
//     throw createError(
//       MESSAGES.VARIANT.ASSOCIATED_PRODUCT_NOT_FOUND,
//       STATUS.NOT_FOUND,
//       ERROR_CODES.PRODUCT_NOT_FOUND
//     );
//   }


//   return {
//     id: variant._id,
//     productId: variant.productId,
//     color: variant.color,
//     price: variant.price,
//     images: variant.images,
//     sizes: variant.sizes,
//     isActive: variant.isActive,
//     createdAt: variant.createdAt,
//     updatedAt: variant.updatedAt,
//   };
// };

const addVariant = async (
  productId,
  {
    color,
    price,
    images,
    sizes,
  }
) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
    );
  }


  const product = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
    );
  }

  if (!product.isActive) {
    throw createError(
      MESSAGES.VARIANT.CANNOT_ADD_A_VARIANT_TO_AN_INACTIVE_PRODUCT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_INACTIVE
    );
  }

  const variantColor = (color || '').trim();

  if (!variantColor) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_COLOR_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_COLOR_REQUIRED
    );
  }

  if (
    price === undefined ||
    price === null ||
    price === ''
  ) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_PRICE_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_PRICE_REQUIRED
    );
  }

  if (
    typeof price !== 'number' ||
    price < 0
  ) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_PRICE_MUST_BE_NON_NEGATIVE,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_VARIANT_PRICE
    );
  }

  if (
    !Array.isArray(images) ||
    images.length < 3
  ) {
    throw createError(
      MESSAGES.VARIANT.A_VARIANT_MUST_HAVE_MINIMUM_3_IMAGES,
      STATUS.BAD_REQUEST,
      ERROR_CODES.MINIMUM_IMAGES_REQUIRED
    );
  }

  if (
    !Array.isArray(sizes) ||
    sizes.length === 0
  ) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_MUST_HAVE_AT_LEAST_ONE_SIZE,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_SIZE_REQUIRED
    );
  }

  for (const sizeItem of sizes) {

    const size = (sizeItem.size || '').trim();

    if (!size) {
      throw createError(
        MESSAGES.VARIANT.SIZE_IS_REQUIRED_FOR_EVERY_INVENTORY_ITEM,
        STATUS.BAD_REQUEST,
        ERROR_CODES.SIZE_REQUIRED
      );
    }

    if (
      sizeItem.stock === undefined ||
      sizeItem.stock === null
    ) {
      throw createError(
        MESSAGES.VARIANT.STOCK_IS_REQUIRED_FOR_SIZE(size),
        STATUS.BAD_REQUEST,
        ERROR_CODES.STOCK_REQUIRED
      );
    }


    if (
      typeof sizeItem.stock !== 'number' ||
      sizeItem.stock < 0
    ) {
      throw createError(
        MESSAGES.VARIANT.STOCK_MUST_BE_NON_NEGATIVE_FOR_SIZE(size),
        STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STOCK
      );
    }
  }


  const newVariant = await Variant.create({
    productId: product._id,
    color: variantColor,
    price,
    images,
    sizes: sizes.map((sizeItem) => ({
      size: sizeItem.size.trim(),
      stock: sizeItem.stock,
    })),
  });

  return {
    id: newVariant._id,
    productId: newVariant.productId,
    color: newVariant.color,
    price: newVariant.price,
    images: newVariant.images,
    sizes: newVariant.sizes,
    isActive: newVariant.isActive,
    createdAt: newVariant.createdAt,
    updatedAt: newVariant.updatedAt,
  };
};



const updateVariant = async (
  variantId,
  {
    color,
    price,
    images,
    sizes,
  }
) => {

  // -----------------------------------
  // 1. Validate variant ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    throw createError(
      MESSAGES.VARIANT.INVALID_VARIANT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_VARIANT_ID
    );
  }


  // -----------------------------------
  // 2. Find variant
  // -----------------------------------

  const existingVariant = await Variant.findOne({
  _id: variantId,
  deletedAt: null,
});

  if (!existingVariant) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.VARIANT_NOT_FOUND
    );
  }


  // -----------------------------------
  // 3. Check variant status
  // -----------------------------------

  if (!existingVariant.isActive) {
    throw createError(
      MESSAGES.VARIANT.CANNOT_EDIT_AN_INACTIVE_VARIANT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_INACTIVE
    );
  }


  // -----------------------------------
  // 4. Validate color
  // -----------------------------------

  const variantColor = (color || '').trim();

  if (!variantColor) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_COLOR_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_COLOR_REQUIRED
    );
  }


  // -----------------------------------
  // 5. Validate price
  // -----------------------------------

  if (
    price === undefined ||
    price === null ||
    price === ''
  ) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_PRICE_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_PRICE_REQUIRED
    );
  }

  if (
    typeof price !== 'number' ||
    price < 0
  ) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_PRICE_MUST_BE_NON_NEGATIVE,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_VARIANT_PRICE
    );
  }


  // -----------------------------------
  // 6. Validate images
  // -----------------------------------

  if (
    !Array.isArray(images) ||
    images.length < 3
  ) {
    throw createError(
      MESSAGES.VARIANT.A_VARIANT_MUST_HAVE_MINIMUM_3_IMAGES,
      STATUS.BAD_REQUEST,
      ERROR_CODES.MINIMUM_IMAGES_REQUIRED
    );
  }


  // -----------------------------------
  // 7. Validate sizes
  // -----------------------------------

  if (
    !Array.isArray(sizes) ||
    sizes.length === 0
  ) {
    throw createError(
      MESSAGES.VARIANT.A_VARIANT_MUST_HAVE_AT_LEAST_ONE_SIZE,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_SIZE_REQUIRED
    );
  }


  // -----------------------------------
  // 8. Validate each size
  // -----------------------------------

  for (const sizeItem of sizes) {

    const size = (sizeItem.size || '').trim();

    if (!size) {
      throw createError(
        MESSAGES.VARIANT.SIZE_IS_REQUIRED_FOR_EVERY_INVENTORY_ITEM,
        STATUS.BAD_REQUEST,
        ERROR_CODES.SIZE_REQUIRED
      );
    }


    if (
      sizeItem.stock === undefined ||
      sizeItem.stock === null
    ) {
      throw createError(
        MESSAGES.VARIANT.STOCK_IS_REQUIRED_FOR_SIZE(size),
        STATUS.BAD_REQUEST,
        ERROR_CODES.STOCK_REQUIRED
      );
    }


    if (
      typeof sizeItem.stock !== 'number' ||
      sizeItem.stock < 0
    ) {
      throw createError(
        MESSAGES.VARIANT.STOCK_MUST_BE_NON_NEGATIVE_FOR_SIZE(size),
        STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STOCK
      );
    }
  }


  // -----------------------------------
  // 9. Make sure parent product exists
  // -----------------------------------

const product = await Product.findOne({
  _id: existingVariant.productId,
  deletedAt: null,
});

  if (!product) {
    throw createError(
      MESSAGES.VARIANT.ASSOCIATED_PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
    );
  }


  // -----------------------------------
  // 10. Check parent product status
  // -----------------------------------

  if (!product.isActive) {
    throw createError(
      MESSAGES.VARIANT.CANNOT_EDIT_A_VARIANT_OF_AN_INACTIVE_PRODUCT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_INACTIVE
    );
  }


  // -----------------------------------
  // 11. Update variant
  // -----------------------------------

  existingVariant.color = variantColor;
  existingVariant.price = price;
  existingVariant.images = images;

  existingVariant.sizes = sizes.map((sizeItem) => ({
    size: sizeItem.size.trim(),
    stock: sizeItem.stock,
  }));


  // -----------------------------------
  // 12. Save
  // -----------------------------------

  const updatedVariant = await existingVariant.save();


  // -----------------------------------
  // 13. Return updated variant
  // -----------------------------------

  return {
    id: updatedVariant._id,
    productId: updatedVariant.productId,
    color: updatedVariant.color,
    price: updatedVariant.price,
    images: updatedVariant.images,
    sizes: updatedVariant.sizes,
    isActive: updatedVariant.isActive,
    createdAt: updatedVariant.createdAt,
    updatedAt: updatedVariant.updatedAt,
  };
};

const deleteVariant = async (variantId) => {

  // -----------------------------------
  // 1. Validate variant ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    throw createError(
      MESSAGES.VARIANT.INVALID_VARIANT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_VARIANT_ID
    );
  }


  // -----------------------------------
  // 2. Find non-deleted variant
  // -----------------------------------

  const existingVariant = await Variant.findOne({
    _id: variantId,
    deletedAt: null,
  });

  if (!existingVariant) {
    throw createError(
      MESSAGES.VARIANT.VARIANT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.VARIANT_NOT_FOUND
    );
  }


  // -----------------------------------
  // 3. Soft delete variant
  // -----------------------------------

  existingVariant.deletedAt = new Date();

  await existingVariant.save();


  // -----------------------------------
  // 4. Return response
  // -----------------------------------

  return {
    message: MESSAGES.VARIANT.VARIANT_DELETED_SUCCESSFULLY,
  };
};

// const toggleVariantStatus = async (variantId) => {

//   // -----------------------------------
//   // 1. Validate variant ID
//   // -----------------------------------

//   if (!mongoose.Types.ObjectId.isValid(variantId)) {
//     throw createError(
//       MESSAGES.VARIANT.INVALID_VARIANT_ID,
//       STATUS.BAD_REQUEST,
//       ERROR_CODES.INVALID_VARIANT_ID
//     );
//   }


//   // -----------------------------------
//   // 2. Find non-deleted variant
//   // -----------------------------------

//   const existingVariant = await Variant.findOne({
//     _id: variantId,
//     deletedAt: null,
//   });

//   if (!existingVariant) {
//     throw createError(
//       MESSAGES.VARIANT.VARIANT_NOT_FOUND,
//       STATUS.NOT_FOUND,
//       ERROR_CODES.VARIANT_NOT_FOUND
//     );
//   }


//   // -----------------------------------
//   // 3. Make sure parent product exists
//   // -----------------------------------

//   const product = await Product.findOne({
//     _id: existingVariant.productId,
//     deletedAt: null,
//   });

//   if (!product) {
//     throw createError(
//       MESSAGES.VARIANT.ASSOCIATED_PRODUCT_NOT_FOUND,
//       STATUS.NOT_FOUND,
//       ERROR_CODES.PRODUCT_NOT_FOUND
//     );
//   }


//   // -----------------------------------
//   // 4. Check parent product status
//   // -----------------------------------

//   if (!product.isActive) {
//     throw createError(
//       MESSAGES.VARIANT.CANNOT_CHANGE_STATUS_OF_VARIANT_OF_INACTIVE_PRODUCT,
//       STATUS.BAD_REQUEST,
//       ERROR_CODES.PRODUCT_INACTIVE
//     );
//   }


//   // -----------------------------------
//   // 5. Toggle variant status
//   // -----------------------------------

//   existingVariant.isActive = !existingVariant.isActive;

//   await existingVariant.save();


//   // -----------------------------------
//   // 6. Return response
//   // -----------------------------------

//   return {
//     message: existingVariant.isActive
//       ? MESSAGES.VARIANT.VARIANT_ACTIVATED_SUCCESSFULLY
//       : MESSAGES.VARIANT.VARIANT_DEACTIVATED_SUCCESSFULLY,
//     isActive: existingVariant.isActive,
//   };
// };

module.exports = {
  updateVariant,
  deleteVariant,
  getVariants,
  addVariant
};