const Product = require('../../models/products');
const Variant = require('../../models/variants');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');

const mongoose = require('mongoose');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

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
      MESSAGES.COMMON.PAGE_MUST_BE_GREATER_THAN_0,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PAGE
    );
  }

  if (limitNum < 1) {
    throw createError(
      MESSAGES.COMMON.LIMIT_MUST_BE_GREATER_THAN_0,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_LIMIT
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
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
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
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
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
      MESSAGES.PRODUCT.PRODUCT_NAME_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_NAME_REQUIRED
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
      MESSAGES.PRODUCT.A_PRODUCT_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.PRODUCT_ALREADY_EXISTS
    );
  }

  const productDescription = (description || '').trim();

  if (!productDescription) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_DESCRIPTION_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_DESCRIPTION_REQUIRED
    );
  }

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      MESSAGES.CATEGORY.INVALID_CATEGORY_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_CATEGORY_ID
    );
  }

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      MESSAGES.BRAND.INVALID_BRAND_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_BRAND_ID
    );
  }

  const productGender = (gender || '').trim().toLowerCase();

  if (!GENDERS.includes(productGender)) {
    throw createError(
      MESSAGES.PRODUCT.GENDER_MUST_BE_MEN_WOMEN_OR_UNISEX,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_GENDER
    );
  }

  if (!Array.isArray(variants) || variants.length === 0) {
    throw createError(
      MESSAGES.PRODUCT.AT_LEAST_ONE_VARIANT_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.VARIANT_REQUIRED
    );
  }

  const category = await Category.findOne({
    _id: categoryId,
    deletedAt: null,
  });

  if (!category) {
    throw createError(
      MESSAGES.CATEGORY.CATEGORY_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.CATEGORY_NOT_FOUND
    );
  }

  if (!category.isActive) {
    throw createError(
      MESSAGES.PRODUCT.CANNOT_CREATE_PRODUCT_UNDER_AN_INACTIVE_CATEGORY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CATEGORY_INACTIVE
    );
  }

  const brand = await Brand.findOne({
    _id: brandId,
    deletedAt: null,
  });

  if (!brand) {
    throw createError(
      MESSAGES.BRAND.BRAND_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.BRAND_NOT_FOUND
    );
  }

  if (!brand.isActive) {
    throw createError(
      MESSAGES.PRODUCT.CANNOT_CREATE_PRODUCT_WITH_AN_INACTIVE_BRAND,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_INACTIVE
    );
  }

  for (const variant of variants) {

    // Color
    const color = (variant.color || '').trim();

    if (!color) {
      throw createError(
        MESSAGES.VARIANT.VARIANT_COLOR_IS_REQUIRED,
        STATUS.BAD_REQUEST,
        ERROR_CODES.VARIANT_COLOR_REQUIRED
      );
    }

    if (
      variant.price === undefined ||
      variant.price === null ||
      variant.price === ''
    ) {
      throw createError(
        MESSAGES.VARIANT.VARIANT_PRICE_IS_REQUIRED,
        STATUS.BAD_REQUEST,
        ERROR_CODES.VARIANT_PRICE_REQUIRED
      );
    }

    if (
      typeof variant.price !== 'number' ||
      variant.price < 0
    ) {
      throw createError(
        MESSAGES.VARIANT.VARIANT_PRICE_MUST_BE_NON_NEGATIVE,
        STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_VARIANT_PRICE
      );
    }

    if (
      !Array.isArray(variant.images) ||
      variant.images.length < 3
    ) {
      throw createError(
        MESSAGES.VARIANT.A_VARIANT_MUST_HAVE_MINIMUM_3_IMAGES,
        STATUS.BAD_REQUEST,
        ERROR_CODES.MINIMUM_IMAGES_REQUIRED
      );
    }

    if (
      !Array.isArray(variant.sizes) ||
      variant.sizes.length === 0
    ) {
      throw createError(
        MESSAGES.VARIANT.A_VARIANT_MUST_HAVE_AT_LEAST_ONE_SIZE,
        STATUS.BAD_REQUEST,
        ERROR_CODES.VARIANT_SIZE_REQUIRED
      );
    }

    for (const sizeItem of variant.sizes) {

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
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
    );
  }

  const existingProduct = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!existingProduct) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
    );
  }

  if (!existingProduct.isActive) {
    throw createError(
      MESSAGES.PRODUCT.CANNOT_EDIT_AN_INACTIVE_PRODUCT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_INACTIVE
    );
  }

  const name = typeof productName === 'string' ? productName.trim() : '';

  if (!name) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NAME_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_NAME_REQUIRED
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
      MESSAGES.PRODUCT.A_PRODUCT_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.PRODUCT_ALREADY_EXISTS
    );
  }

  const productDescription =
    typeof description === 'string' ? description.trim() : '';

  if (!productDescription) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_DESCRIPTION_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.PRODUCT_DESCRIPTION_REQUIRED
    );
  }


  const productGender =
    typeof gender === 'string' ? gender.trim().toLowerCase() : '';

  if (!GENDERS.includes(productGender)) {
    throw createError(
      MESSAGES.PRODUCT.GENDER_MUST_BE_MEN_WOMEN_OR_UNISEX,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_GENDER
    );
  }

  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      MESSAGES.CATEGORY.INVALID_CATEGORY_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_CATEGORY_ID
    );
  }

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      MESSAGES.BRAND.INVALID_BRAND_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_BRAND_ID
    );
  }

  const category = await Category.findOne({
    _id: categoryId,
    deletedAt: null,
  });

  if (!category) {
    throw createError(
      MESSAGES.CATEGORY.CATEGORY_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.CATEGORY_NOT_FOUND
    );
  }

  if (!category.isActive) {
    throw createError(
      MESSAGES.PRODUCT.CANNOT_ASSIGN_AN_INACTIVE_CATEGORY_TO_A_PRODUCT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CATEGORY_INACTIVE
    );
  }

  const brand = await Brand.findOne({
    _id: brandId,
    deletedAt: null,
  });

  if (!brand) {
    throw createError(
      MESSAGES.BRAND.BRAND_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.BRAND_NOT_FOUND
    );
  }

  if (!brand.isActive) {
    throw createError(
      MESSAGES.PRODUCT.CANNOT_ASSIGN_AN_INACTIVE_BRAND_TO_A_PRODUCT,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_INACTIVE
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
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
    );
  }

  const existingProduct = await Product.findOne({
    _id: productId,
    deletedAt: null,
  });

  if (!existingProduct) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
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
    message: MESSAGES.PRODUCT.PRODUCT_DELETED_SUCCESSFULLY,
  };
};

const toggleProductStatus = async (productId) => {

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw createError(
      MESSAGES.PRODUCT.INVALID_PRODUCT_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_PRODUCT_ID
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
    { new: true, updatePipeline: true }
  );

  if (!updatedProduct) {
    throw createError(
      MESSAGES.PRODUCT.PRODUCT_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.PRODUCT_NOT_FOUND
    );
  }

  return {
    message: updatedProduct.isActive
      ? MESSAGES.PRODUCT.PRODUCT_ACTIVATED_SUCCESSFULLY
      : MESSAGES.PRODUCT.PRODUCT_DEACTIVATED_SUCCESSFULLY,
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
