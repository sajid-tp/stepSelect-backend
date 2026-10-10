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

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { productName: 1 },
  name_desc: { productName: -1 },
};


const getProducts = async ({
  search,
  page = 1,
  limit = 5,
  sort,
  status,
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
    deletedAt: null,
  };

  if (search && search.trim()) {
    const escapedSearch = search
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    filter.productName = {
      $regex: escapedSearch,
      $options: 'i',
    };
  }

  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }


  const sortOption = {
    ...(SORT_MAP[sort] || SORT_MAP.newest),
    _id: -1,
  };

  const skip = (pageNum - 1) * limitNum;

  const [products, totalProducts] = await Promise.all([
    Product.find(filter)
      .populate('brandId', 'brandName')
      .populate('categoryId', 'categoryName')
      .sort(sortOption)
      .collation({ locale: 'en', strength: 2 })
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
    deletedAt: null,
  })
    .select('productId price images')
    .sort({ price: 1 });

  const variantMap = new Map();

  for (const variant of variants) {

    const productId = variant.productId.toString();

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

      gender: product.gender,

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

    gender: product.gender,

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

  const productDescription = (description || '').trim();

  if (!productDescription) {
    throw createError(
      'Product description is required.',
      400,
      'PRODUCT_DESCRIPTION_REQUIRED'
    );
  }

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      'Invalid category id.',
      400,
      'INVALID_CATEGORY_ID'
    );
  }

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

  if (!Array.isArray(variants) || variants.length === 0) {
    throw createError(
      'At least one variant is required.',
      400,
      'VARIANT_REQUIRED'
    );
  }

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

  if (!category.isActive) {
    throw createError(
      'Cannot create product under an inactive category.',
      400,
      'CATEGORY_INACTIVE'
    );
  }

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

  if (!brand.isActive) {
    throw createError(
      'Cannot create product with an inactive brand.',
      400,
      'BRAND_INACTIVE'
    );
  }

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

  const product = await Product.create({
    productName: name,
    description: productDescription,
    gender: productGender,
    categoryId,
    brandId,
  });

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

  const createdVariants = await Variant.insertMany(
    variantData
  );

  return {
    id: product._id,
    productName: product.productName,
    description: product.description,
    categoryId: product.categoryId,
    brandId: product.brandId,
    gender: product.gender,
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

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

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

  if (!existingProduct.isActive) {
    throw createError(
      'Cannot edit an inactive product.',
      400,
      'PRODUCT_INACTIVE'
    );
  }

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

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      'Invalid category id.',
      400,
      'INVALID_CATEGORY_ID'
    );
  }

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }

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

  if (!category.isActive) {
    throw createError(
      'Cannot assign an inactive category to a product.',
      400,
      'CATEGORY_INACTIVE'
    );
  }

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

  if (!brand.isActive) {
    throw createError(
      'Cannot assign an inactive brand to a product.',
      400,
      'BRAND_INACTIVE'
    );
  }

  existingProduct.productName = name;
  existingProduct.description = productDescription;
  existingProduct.categoryId = categoryId;
  existingProduct.brandId = brandId;
  existingProduct.gender = productGender;

  const updatedProduct = await existingProduct.save();

  return {
    id: updatedProduct._id,
    productName: updatedProduct.productName,
    description: updatedProduct.description,
    categoryId: updatedProduct.categoryId,
    brandId: updatedProduct.brandId,
    gender: updatedProduct.gender,
    isActive: updatedProduct.isActive,
    createdAt: updatedProduct.createdAt,
    updatedAt: updatedProduct.updatedAt,
  };
};



const deleteProduct = async (productId) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

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

  const deletedAt = new Date();

  existingProduct.deletedAt = deletedAt;

  await existingProduct.save();

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

  return {
    message: 'Product deleted successfully.',
  };
};

const toggleProductStatus = async (productId) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      'Invalid product id.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

  const updatedProduct = await Product.findOneAndUpdate(
    {
      _id: productId,
      deletedAt: null,
    },
    [
      {
        $set: {
          isActive: { $not: '$isActive' },
        },
      },
    ],
    { new: true }
  );

  if (!updatedProduct) {
    throw createError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }

  return {
    message: `Product ${
      updatedProduct.isActive ? 'activated' : 'deactivated'
    } successfully.`,
    isActive: updatedProduct.isActive,
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
