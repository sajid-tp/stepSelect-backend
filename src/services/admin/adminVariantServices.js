const mongoose = require('mongoose');

const Variant = require('../../models/variants');
const Product = require('../../models/products');

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


const getVariants = async (
  productId,
  { page = 1, limit = 5 }
) => {

  // -----------------------------------
  // 1. Validate product ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }


  // -----------------------------------
  // 2. Validate pagination
  // -----------------------------------

  const pageNum = Number(page);
  const limitNum = Number(limit);

  if (
    !Number.isInteger(pageNum) ||
    pageNum < 1
  ) {
    throw createError(
      'Page must be greater than 0.',
      400,
      'INVALID_PAGE'
    );
  }

  if (
    !Number.isInteger(limitNum) ||
    limitNum < 1
  ) {
    throw createError(
      'Limit must be greater than 0.',
      400,
      'INVALID_LIMIT'
    );
  }


  // -----------------------------------
  // 3. Make sure product exists
  // -----------------------------------

  const product = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 4. Build variant filter
  // -----------------------------------

  const filter = {
    productId: product._id,
    deletedAt: null,
  };


  // -----------------------------------
  // 5. Calculate pagination
  // -----------------------------------

  const skip = (pageNum - 1) * limitNum;


  // -----------------------------------
  // 6. Get variants + total count
  // -----------------------------------

  const [variants, totalVariants] = await Promise.all([
    Variant.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),

    Variant.countDocuments(filter),
  ]);


  // -----------------------------------
  // 7. Format response
  // -----------------------------------

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


  // -----------------------------------
  // 8. Return response
  // -----------------------------------

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


const getVariant = async (variantId) => {

  // -----------------------------------
  // 1. Validate variant ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    throw createError(
      'Invalid variant id.',
      400,
      'INVALID_VARIANT_ID'
    );
  }


  // -----------------------------------
  // 2. Find non-deleted variant
  // -----------------------------------

  const variant = await Variant.findOne({
    _id: variantId,
    deletedAt: null,
  });

  if (!variant) {
    throw createError(
      'Variant not found.',
      404,
      'VARIANT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Make sure parent product exists
  // -----------------------------------

  const product = await Product.findOne({
    _id: variant.productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      'Associated product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 4. Return variant
  // -----------------------------------

  return {
    id: variant._id,
    productId: variant.productId,
    color: variant.color,
    price: variant.price,
    images: variant.images,
    sizes: variant.sizes,
    isActive: variant.isActive,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
};

const addVariant = async (
  productId,
  {
    color,
    price,
    images,
    sizes,
  }
) => {

  // -----------------------------------
  // 1. Validate product ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }


  // -----------------------------------
  // 2. Find existing non-deleted product
  // -----------------------------------

  const product = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Check product status
  // -----------------------------------

  if (!product.isActive) {
    throw createError(
      'Cannot add a variant to an inactive product.',
      400,
      'PRODUCT_INACTIVE'
    );
  }


  // -----------------------------------
  // 4. Validate color
  // -----------------------------------

  const variantColor = (color || '').trim();

  if (!variantColor) {
    throw createError(
      'Variant color is required.',
      400,
      'VARIANT_COLOR_REQUIRED'
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
      'Variant price is required.',
      400,
      'VARIANT_PRICE_REQUIRED'
    );
  }

  if (
    typeof price !== 'number' ||
    price < 0
  ) {
    throw createError(
      'Variant price must be a valid non-negative number.',
      400,
      'INVALID_VARIANT_PRICE'
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
      'A variant must have minimum 3 images.',
      400,
      'MINIMUM_IMAGES_REQUIRED'
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
      'Variant must have at least one size.',
      400,
      'VARIANT_SIZE_REQUIRED'
    );
  }


  // -----------------------------------
  // 8. Validate each size
  // -----------------------------------

  for (const sizeItem of sizes) {

    const size = (sizeItem.size || '').trim();

    if (!size) {
      throw createError(
        'Size is required for every inventory item.',
        400,
        'SIZE_REQUIRED'
      );
    }


    if (
      sizeItem.stock === undefined ||
      sizeItem.stock === null
    ) {
      throw createError(
        `Stock is required for size ${size}.`,
        400,
        'STOCK_REQUIRED'
      );
    }


    if (
      typeof sizeItem.stock !== 'number' ||
      sizeItem.stock < 0
    ) {
      throw createError(
        `Stock must be a non-negative number for size ${size}.`,
        400,
        'INVALID_STOCK'
      );
    }
  }


  // -----------------------------------
  // 9. Create variant
  // -----------------------------------

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


  // -----------------------------------
  // 10. Return created variant
  // -----------------------------------

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
      'Invalid variant id.',
      400,
      'INVALID_VARIANT_ID'
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
      'Variant not found.',
      404,
      'VARIANT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Check variant status
  // -----------------------------------

  if (!existingVariant.isActive) {
    throw createError(
      'Cannot edit an inactive variant.',
      400,
      'VARIANT_INACTIVE'
    );
  }


  // -----------------------------------
  // 4. Validate color
  // -----------------------------------

  const variantColor = (color || '').trim();

  if (!variantColor) {
    throw createError(
      'Variant color is required.',
      400,
      'VARIANT_COLOR_REQUIRED'
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
      'Variant price is required.',
      400,
      'VARIANT_PRICE_REQUIRED'
    );
  }

  if (
    typeof price !== 'number' ||
    price < 0
  ) {
    throw createError(
      'Variant price must be a valid non-negative number.',
      400,
      'INVALID_VARIANT_PRICE'
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
      'A variant must have minimum 3 images.',
      400,
      'MINIMUM_IMAGES_REQUIRED'
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
      'A variant must have at least one size.',
      400,
      'VARIANT_SIZE_REQUIRED'
    );
  }


  // -----------------------------------
  // 8. Validate each size
  // -----------------------------------

  for (const sizeItem of sizes) {

    const size = (sizeItem.size || '').trim();

    if (!size) {
      throw createError(
        'Size is required for every inventory item.',
        400,
        'SIZE_REQUIRED'
      );
    }


    if (
      sizeItem.stock === undefined ||
      sizeItem.stock === null
    ) {
      throw createError(
        `Stock is required for size ${size}.`,
        400,
        'STOCK_REQUIRED'
      );
    }


    if (
      typeof sizeItem.stock !== 'number' ||
      sizeItem.stock < 0
    ) {
      throw createError(
        `Stock must be a non-negative number for size ${size}.`,
        400,
        'INVALID_STOCK'
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
      'Associated product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 10. Check parent product status
  // -----------------------------------

  if (!product.isActive) {
    throw createError(
      'Cannot edit a variant of an inactive product.',
      400,
      'PRODUCT_INACTIVE'
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
      'Invalid variant id.',
      400,
      'INVALID_VARIANT_ID'
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
      'Variant not found.',
      404,
      'VARIANT_NOT_FOUND'
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
    message: 'Variant deleted successfully.',
  };
};

const toggleVariantStatus = async (variantId) => {

  // -----------------------------------
  // 1. Validate variant ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(variantId)) {
    throw createError(
      'Invalid variant id.',
      400,
      'INVALID_VARIANT_ID'
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
      'Variant not found.',
      404,
      'VARIANT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Make sure parent product exists
  // -----------------------------------

  const product = await Product.findOne({
    _id: existingVariant.productId,
    deletedAt: null,
  });

  if (!product) {
    throw createError(
      'Associated product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 4. Check parent product status
  // -----------------------------------

  if (!product.isActive) {
    throw createError(
      'Cannot change status of a variant belonging to an inactive product.',
      400,
      'PRODUCT_INACTIVE'
    );
  }


  // -----------------------------------
  // 5. Toggle variant status
  // -----------------------------------

  existingVariant.isActive = !existingVariant.isActive;

  await existingVariant.save();


  // -----------------------------------
  // 6. Return response
  // -----------------------------------

  return {
    message: `Variant ${
      existingVariant.isActive ? 'activated' : 'deactivated'
    } successfully.`,
    isActive: existingVariant.isActive,
  };
};

module.exports = {
  updateVariant,
  deleteVariant,
  getVariants,
  getVariant,
  toggleVariantStatus,
  addVariant
};