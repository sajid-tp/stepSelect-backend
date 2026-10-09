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

const GENDERS = ['men', 'women', 'unisex'];



const getProducts = async ({
  search,
  page = 1,
  limit = 5,
}) => {

  const pageNum = Number(page);
  const limitNum = Number(limit);

  if (pageNum < 1) {
    throw createError(
      'Page must be greater than 0.',
      400,
      'INVALID_PAGE'
    );
  }

  if (limitNum < 1) {
    throw createError(
      'Limit must be greater than 0.',
      400,
      'INVALID_LIMIT'
    );
  }

  const filter = {
    deletedAt : null
  };

  // Search by product name
  if (search && search.trim()) {
    const escapedSearch = search
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    filter.productName = {
      $regex: escapedSearch,
      $options: 'i',
    };
  }

  const skip = (pageNum - 1) * limitNum;

  const [products, totalProducts] = await Promise.all([
    Product.find(filter)
      .populate('brandId', 'brandName')
      .populate('categoryId', 'categoryName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),

    Product.countDocuments(filter),
  ]);

  const productIds = products.map(
    (product) => product._id
  );

  const variants = await Variant.find({
    productId: { $in: productIds },
    isActive: true,
    deletedAt : null
  })
    .select('productId price images')
    .sort({ price: 1 });

  const variantMap = new Map();

  for (const variant of variants) {

    const productId = variant.productId.toString();

    // First variant will be the lowest-priced
    // because variants are sorted by price ascending
    if (!variantMap.has(productId)) {
      variantMap.set(productId, variant);
    }
  }

  const data = products.map((product) => {

    const variant = variantMap.get(
      product._id.toString()
    );

    return {
      id: product._id,

      productName: product.productName,

       description: product.description,

       gender : product.gender,

      brand: {
        id: product.brandId?._id,
        name: product.brandId?.brandName,
      },

      category: {
        id: product.categoryId?._id,
        name: product.categoryId?.categoryName,
      },

      isActive: product.isActive,

      basePrice: variant ? variant.price : null,

      image: variant?.images?.[0] || null,

      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  });

  return {
    products: data,

    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalProducts / limitNum),
      totalProducts,
      limit: limitNum,
    },
  };
};

const getProduct = async (productId) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

  const product = await Product.findOne({
    _id: productId,
    deletedAt: null,
  })
    .populate('brandId', 'brandName')
    .populate('categoryId', 'categoryName');

  if (!product) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }

  const variants = await Variant.find({
    productId: product._id,
    deletedAt: null,
  });

  return {
    id: product._id,

    productName: product.productName,

    description: product.description,

    gender : product.gender,

    brand: {
      id: product.brandId?._id,
      name: product.brandId?.brandName,
    },

    category: {
      id: product.categoryId?._id,
      name: product.categoryId?.categoryName,
    },

    isActive: product.isActive,

    variants: variants.map((variant) => ({
      id: variant._id,
      color: variant.color,
      price: variant.price,
      images: variant.images,
      sizes: variant.sizes,
      isActive: variant.isActive,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    })),

    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};


const createProduct = async ({
  productName,
  description,
  gender,
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

  const existingProduct = await Product.findOne({
  productName: name,
  deletedAt: null,
}).collation({
  locale: 'en',
  strength: 2,
});

if (existingProduct) {
  throw createError(
    'A product with this name already exists.',
    409,
    'PRODUCT_ALREADY_EXISTS'
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

  const productGender = (gender || '').trim().toLowerCase();

if (!GENDERS.includes(productGender)) {
  throw createError(
    'Gender must be men, women or unisex.',
    400,
    'INVALID_GENDER'
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

const category = await Category.findOne({
  _id: categoryId,
  deletedAt: null,
});

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

 const brand = await Brand.findOne({
  _id: brandId,
  deletedAt: null,
});

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
    gender : productGender,
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
    gender : product.gender,
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
    gender,
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
const existingProduct = await Product.findOne({
  _id: productId,
  deletedAt: null,
});

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

  const duplicateProduct = await Product.findOne({
  _id: { $ne: productId },
  productName: name,
  deletedAt: null,
}).collation({
  locale: 'en',
  strength: 2,
});

if (duplicateProduct) {
  throw createError(
    'A product with this name already exists.',
    409,
    'PRODUCT_ALREADY_EXISTS'
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


  const productGender =
  typeof gender === 'string' ? gender.trim().toLowerCase() : '';

if (!GENDERS.includes(productGender)) {
  throw createError(
    'Gender must be men, women or unisex.',
    400,
    'INVALID_GENDER'
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

 const category = await Category.findOne({
  _id: categoryId,
  deletedAt: null,
});



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

  const brand = await Brand.findOne({
  _id: brandId,
  deletedAt: null,
});

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
  existingProduct.gender = productGender;


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
    gender : updatedProduct.gender,
    isActive: updatedProduct.isActive,
    createdAt: updatedProduct.createdAt,
    updatedAt: updatedProduct.updatedAt,
  };
};



const deleteProduct = async (productId) => {

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
  // 2. Find non-deleted product
  // -----------------------------------

  const existingProduct = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!existingProduct) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Soft delete product
  // -----------------------------------

  const deletedAt = new Date();

  existingProduct.deletedAt = deletedAt;

  await existingProduct.save();


  // -----------------------------------
  // 4. Soft delete its variants
  // -----------------------------------

  await Variant.updateMany(
    {
      productId: existingProduct._id,
      deletedAt: null,
    },
    {
      $set: {
        deletedAt: deletedAt,
      },
    }
  );


  // -----------------------------------
  // 5. Return response
  // -----------------------------------

  return {
    message: 'Product deleted successfully.',
  };
};

const toggleProductStatus = async (productId) => {

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
  // 2. Find non-deleted product
  // -----------------------------------

  const existingProduct = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!existingProduct) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }


  // -----------------------------------
  // 3. Toggle status
  // -----------------------------------

  existingProduct.isActive = !existingProduct.isActive;

  await existingProduct.save();


  // -----------------------------------
  // 4. Return updated status
  // -----------------------------------

  return {
    message: `Product ${
      existingProduct.isActive ? 'activated' : 'deactivated'
    } successfully.`,
    isActive: existingProduct.isActive,
  };
};




module.exports = {
  createProduct,
  updateProduct,
  getProducts,
  getProduct,
  deleteProduct,
  toggleProductStatus
};