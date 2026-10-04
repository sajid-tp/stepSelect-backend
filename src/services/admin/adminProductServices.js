const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');

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

  const name = (productName || '').trim();

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

  const productDescription = (description || '').trim();

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

  const brand = await Brand.findById(brandId);

  if (!brand) {
    throw createError(
      'Brand not found.',
      404,
      'BRAND_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 9. Check brand is active
  // -----------------------------------

  if (!brand.isActive) {
    throw createError(
      'Cannot create product with an inactive brand.',
      400,
      'BRAND_INACTIVE'
    );
  }


  // -----------------------------------
  // 10. Validate each variant
  // -----------------------------------

  for (const variant of variants) {

    // Color
    const color = (variant.color || '').trim();

    if (!color) {
      throw createError(
        'Variant color is required.',
        400,
        'VARIANT_COLOR_REQUIRED'
      );
    }


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

    if (
      typeof variant.price !== 'number' ||
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


    // Validate each size
    for (const sizeItem of variant.sizes) {

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
  }


  // -----------------------------------
  // 11. Create Product
  // -----------------------------------

  const product = await Product.create({
    productName: name,
    description: productDescription,
    categoryId,
    brandId,
  });


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

  const createdVariants = await Variant.insertMany(
    variantData
  );


  // -----------------------------------
  // 14. Return response
  // -----------------------------------

  return {
    id: product._id,
    productName: product.productName,
    description: product.description,
    categoryId: product.categoryId,
    brandId: product.brandId,
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

const updateProduct = async (
  productId,
  {
    productName,
    description,
    categoryId,
    brandId,
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
  // 2. Find product
  // -----------------------------------

  const existingProduct = await Product.findById(productId);

  if (!existingProduct) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Check product status
  // -----------------------------------

  if (!existingProduct.isActive) {
    throw createError(
      'Cannot edit an inactive product.',
      400,
      'PRODUCT_INACTIVE'
    );
  }


  // -----------------------------------
  // 4. Validate product name
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
  // 5. Validate description
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
  // 6. Validate category ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      'Invalid category id.',
      400,
      'INVALID_CATEGORY_ID'
    );
  }


  // -----------------------------------
  // 7. Validate brand ID
  // -----------------------------------

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }


  // -----------------------------------
  // 8. Check category
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
  // 9. Check category is active
  // -----------------------------------

  if (!category.isActive) {
    throw createError(
      'Cannot assign an inactive category to a product.',
      400,
      'CATEGORY_INACTIVE'
    );
  }


  // -----------------------------------
  // 10. Check brand
  // -----------------------------------

  const brand = await Brand.findById(brandId);

  if (!brand) {
    throw createError(
      'Brand not found.',
      404,
      'BRAND_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 11. Check brand is active
  // -----------------------------------

  if (!brand.isActive) {
    throw createError(
      'Cannot assign an inactive brand to a product.',
      400,
      'BRAND_INACTIVE'
    );
  }


  // -----------------------------------
  // 12. Update product
  // -----------------------------------

  existingProduct.productName = name;
  existingProduct.description = productDescription;
  existingProduct.categoryId = categoryId;
  existingProduct.brandId = brandId;


  // -----------------------------------
  // 13. Save
  // -----------------------------------

  const updatedProduct = await existingProduct.save();


  // -----------------------------------
  // 14. Return updated product
  // -----------------------------------

  return {
    id: updatedProduct._id,
    productName: updatedProduct.productName,
    description: updatedProduct.description,
    categoryId: updatedProduct.categoryId,
    brandId: updatedProduct.brandId,
    isActive: updatedProduct.isActive,
    createdAt: updatedProduct.createdAt,
    updatedAt: updatedProduct.updatedAt,
  };
};


module.exports = {
  createProduct,
  updateProduct
};