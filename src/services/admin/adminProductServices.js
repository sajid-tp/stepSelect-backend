const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
// const Brand = require('../../models/brands');

const mongoose = require('mongoose');


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


const createProduct = async ({
  productName,
  description,
  categoryId,
  brandId,
  variants,
}) => {

  // -----------------------------------
  // 1. Validate product name
  // -----------------------------------

  // CHANGED: only trim if it is a string
  const name = typeof productName === 'string' ? productName.trim() : '';

  if (!name) {
    throw createError(
      'Product name is required.',
      400,
      'PRODUCT_NAME_REQUIRED'
    );
  }


  // -----------------------------------
  // 2. Validate description
  // -----------------------------------

  // CHANGED: only trim if it is a string
  const productDescription =
    typeof description === 'string' ? description.trim() : '';

  if (!productDescription) {
    throw createError(
      'Product description is required.',
      400,
      'PRODUCT_DESCRIPTION_REQUIRED'
    );
  }


  // -----------------------------------
  // 3. Validate category ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      'Invalid category id.',
      400,
      'INVALID_CATEGORY_ID'
    );
  }


  // -----------------------------------
  // 4. Validate brand ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }


  // -----------------------------------
  // 5. Validate variants
  // -----------------------------------

  if (!Array.isArray(variants) || variants.length === 0) {
    throw createError(
      'At least one variant is required.',
      400,
      'VARIANT_REQUIRED'
    );
  }


  // -----------------------------------
  // 6. Check category exists
  // -----------------------------------

  const category = await Category.findById(categoryId);

  if (!category) {
    throw createError(
      'Category not found.',
      404,
      'CATEGORY_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 7. Check category is active
  // -----------------------------------

  if (!category.isActive) {
    throw createError(
      'Cannot create product under an inactive category.',
      400,
      'CATEGORY_INACTIVE'
    );
  }


  // -----------------------------------
  // 8. Check brand exists
  // -----------------------------------

//   const brand = await Brand.findById(brandId);

//   if (!brand) {
//     throw createError(
//       'Brand not found.',
//       404,
//       'BRAND_NOT_FOUND'
//     );
//   }


  // -----------------------------------
  // 9. Check brand is active
  // -----------------------------------

//   if (!brand.isActive) {
//     throw createError(
//       'Cannot create product with an inactive brand.',
//       400,
//       'BRAND_INACTIVE'
//     );
//   }


  // -----------------------------------
  // 10. Validate each variant
  // -----------------------------------

  // CHANGED: track colors to detect duplicates
  const seenColors = new Set();

  for (const variant of variants) {

    // CHANGED: variant must be an object
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      throw createError(
        'Invalid variant.',
        400,
        'INVALID_VARIANT'
      );
    }

    // Color
    // CHANGED: only trim if it is a string
    const color = typeof variant.color === 'string' ? variant.color.trim() : '';

    if (!color) {
      throw createError(
        'Variant color is required.',
        400,
        'VARIANT_COLOR_REQUIRED'
      );
    }

    // CHANGED: duplicate color check
    if (seenColors.has(color.toLowerCase())) {
      throw createError(
        `Duplicate variant color: ${color}.`,
        400,
        'DUPLICATE_VARIANT_COLOR'
      );
    }

    seenColors.add(color.toLowerCase());


    // Price
    if (
      variant.price === undefined ||
      variant.price === null ||
      variant.price === ''
    ) {
      throw createError(
        'Variant price is required.',
        400,
        'VARIANT_PRICE_REQUIRED'
      );
    }

    // CHANGED: rejects NaN and Infinity
    if (
      !Number.isFinite(variant.price) ||
      variant.price < 0
    ) {
      throw createError(
        'Variant price must be a valid non-negative number.',
        400,
        'INVALID_VARIANT_PRICE'
      );
    }


    // Images
    if (
      !Array.isArray(variant.images) ||
      variant.images.length < 3
    ) {
      throw createError(
        'A variant must have minimum 3 images.',
        400,
        'MINIMUM_IMAGES_REQUIRED'
      );
    }

    // CHANGED: every image must be a non-empty string
    if (
      !variant.images.every(
        (img) => typeof img === 'string' && img.trim() !== ''
      )
    ) {
      throw createError(
        'Every image must be a non-empty string.',
        400,
        'INVALID_IMAGE'
      );
    }


    // Sizes
    if (
      !Array.isArray(variant.sizes) ||
      variant.sizes.length === 0
    ) {
      throw createError(
        'A variant must have at least one size.',
        400,
        'VARIANT_SIZE_REQUIRED'
      );
    }


    // CHANGED: track sizes to detect duplicates
    const seenSizes = new Set();

    // Validate each size
    for (const sizeItem of variant.sizes) {

      // CHANGED: size item must be an object
      if (!sizeItem || typeof sizeItem !== 'object' || Array.isArray(sizeItem)) {
        throw createError(
          'Invalid size item.',
          400,
          'INVALID_SIZE_ITEM'
        );
      }

      // CHANGED: only trim if it is a string
      const size = typeof sizeItem.size === 'string' ? sizeItem.size.trim() : '';

      if (!size) {
        throw createError(
          'Size is required for every inventory item.',
          400,
          'SIZE_REQUIRED'
        );
      }

      // CHANGED: duplicate size check
      if (seenSizes.has(size.toLowerCase())) {
        throw createError(
          `Duplicate size ${size} in variant ${color}.`,
          400,
          'DUPLICATE_SIZE'
        );
      }

      seenSizes.add(size.toLowerCase());


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


      // CHANGED: stock must be a whole number (rejects NaN, Infinity, 2.5)
      if (
        !Number.isInteger(sizeItem.stock) ||
        sizeItem.stock < 0
      ) {
        throw createError(
          `Stock must be a non-negative whole number for size ${size}.`,
          400,
          'INVALID_STOCK'
        );
      }
    }
  }


  // -----------------------------------
  // 11. Create Product
  // -----------------------------------

  const product = await Product.create({
    productName: name,
    description: productDescription,
    categoryId,
    // brandId,
  });


  // CHANGED: steps 12 and 13 wrapped in try/catch so a failure
  // removes the product (and any partial variants)
  let createdVariants;

  try {

    // -----------------------------------
    // 12. Prepare Variant data
    // -----------------------------------

    const variantData = variants.map((variant) => ({
      productId: product._id,

      color: variant.color.trim(),

      price: variant.price,

      images: variant.images,

      sizes: variant.sizes.map((sizeItem) => ({
        size: sizeItem.size.trim(),
        stock: sizeItem.stock,
      })),
    }));


    // -----------------------------------
    // 13. Create Variants
    // -----------------------------------

    createdVariants = await Variant.insertMany(
      variantData
    );

  } catch (err) {

    // Manual rollback
    await Variant.deleteMany({ productId: product._id });
    await Product.deleteOne({ _id: product._id });

    // Duplicate key error
    if (err.code === 11000) {
      throw createError(
        'A duplicate value was found while creating the product.',
        409,
        'DUPLICATE_VALUE'
      );
    }

    throw err;
  }


  // -----------------------------------
  // 14. Return response
  // -----------------------------------

  return {
    id: product._id,
    productName: product.productName,
    description: product.description,
    categoryId: product.categoryId,
    // brandId: product.brandId,
    isActive: product.isActive,

    variants: createdVariants.map((variant) => ({
      id: variant._id,
      productId: variant.productId,
      color: variant.color,
      price: variant.price,
      images: variant.images,
      sizes: variant.sizes,
      isActive: variant.isActive,
    })),

    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};


module.exports = {
  createProduct,
};
