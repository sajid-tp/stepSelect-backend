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

  const existingVariant = await Variant.findById(variantId);

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

  const product = await Product.findById(
    existingVariant.productId
  );

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


module.exports = {
  updateVariant,
};