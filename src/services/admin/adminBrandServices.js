const Brand = require('../../models/brands');
const mongoose = require('mongoose');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { brandName: 1 },
  name_desc: { brandName: -1 },
};




const getBrands = async ({ search, page = 1, sort }) => {

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = 8;

  const filter = {
    deletedAt: null,
  };

  const searchText = (search || '').trim();

  if (searchText) {
    const escaped = searchText.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    filter.brandName = {
      $regex: escaped,
      $options: 'i',
    };
  }


  const sortOption = {
    ...(SORT_MAP[sort] || SORT_MAP.newest),
    _id: -1,
  };

  const totalResults = await Brand.countDocuments(filter);

  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  const brands = await Brand.find(filter)
    .sort(sortOption)
    .collation({ locale: 'en', strength: 2 }) // case-insensitive A-Z
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const formattedBrands = brands.map((brand) => ({
    id: brand._id,
    brandName: brand.brandName,
    description: brand.description,
    logo: brand.logo,
    isActive: brand.isActive,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  }));

  return {
    brands: formattedBrands,
    totalResults,
    page: pageNum,
    limit: limitNum,
    totalPages,
  };
};





const createBrand = async ({
  brandName,
  description,
  logo,
}) => {

  const name = (brandName || '').trim();


  if (!name) {
    throw createError(
      MESSAGES.BRAND.BRAND_NAME_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_NAME_REQUIRED
    );
  }


  const existingBrand = await Brand.findOne({
    brandName: name,
    deletedAt : null,
  }).collation({
    locale: 'en',
    strength: 2,
  });

  if (existingBrand) {
    throw createError(
      MESSAGES.BRAND.A_BRAND_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.BRAND_ALREADY_EXISTS
    );
  }

  try {

    const brand = await Brand.create({
      brandName: name,
      description,
      logo,
    });

    return {
      id: brand._id,
      brandName: brand.brandName,
      description: brand.description,
      logo: brand.logo,
      isActive: brand.isActive,
      createdAt: brand.createdAt,
      updatedAt: brand.updatedAt,
    };

  } catch (err) {

    if (err.code === 11000) {
      throw createError(
        MESSAGES.BRAND.A_BRAND_WITH_THIS_NAME_ALREADY_EXISTS,
        STATUS.CONFLICT,
        ERROR_CODES.BRAND_ALREADY_EXISTS
      );
    }

    throw err;
  }
};





const updateBrand = async (
  brandId,
  {
    brandName,
    description,
    logo,
  }
) => {

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      MESSAGES.BRAND.INVALID_BRAND_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_BRAND_ID
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      MESSAGES.BRAND.BRAND_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.BRAND_NOT_FOUND
    );
  }

  if (existingBrand.deletedAt !== null) {
    throw createError(
      MESSAGES.BRAND.CANNOT_EDIT_A_DELETED_BRAND,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_DELETED
    );
  }

  if (!existingBrand.isActive) {
    throw createError(
      MESSAGES.BRAND.CANNOT_EDIT_AN_INACTIVE_BRAND,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_INACTIVE
    );
  }

  const name = (brandName || '').trim();

  if (!name) {
    throw createError(
      MESSAGES.BRAND.BRAND_NAME_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_NAME_REQUIRED
    );
  }


  const duplicateBrand = await Brand.findOne({
    brandName: name,
    deletedAt : null,
    _id: { $ne: brandId },
  }).collation({
    locale: 'en',
    strength: 2,
  });

  if (duplicateBrand) {
    throw createError(
      MESSAGES.BRAND.A_BRAND_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.BRAND_ALREADY_EXISTS
    );
  }

  existingBrand.brandName = name;
  existingBrand.description = description;
  existingBrand.logo = logo;

  try {

    const updatedBrand = await existingBrand.save();

    return {
      id: updatedBrand._id,
      brandName: updatedBrand.brandName,
      description: updatedBrand.description,
      logo: updatedBrand.logo,
      isActive: updatedBrand.isActive,
      createdAt: updatedBrand.createdAt,
      updatedAt: updatedBrand.updatedAt,
    };

  } catch (err) {

    if (err.code === 11000) {

      throw createError(
        MESSAGES.BRAND.A_BRAND_WITH_THIS_NAME_ALREADY_EXISTS,
        STATUS.CONFLICT,
        ERROR_CODES.BRAND_ALREADY_EXISTS
      );
    }

    throw err;
  }
};




const toggleBrandStatus = async (brandId) => {

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      MESSAGES.BRAND.INVALID_BRAND_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_BRAND_ID
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      MESSAGES.BRAND.BRAND_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.BRAND_NOT_FOUND
    );
  }


  if (existingBrand.deletedAt !== null) {
    throw createError(
      MESSAGES.BRAND.CANNOT_CHANGE_THE_STATUS_OF_A_DELETED_BRAND,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_DELETED
    );
  }

  existingBrand.isActive = !existingBrand.isActive;

  await existingBrand.save();

  return {
    id: existingBrand._id,
    brandName: existingBrand.brandName,
    isActive: existingBrand.isActive,
    deletedAt: existingBrand.deletedAt,
  };
};



const deleteBrand = async (brandId) => {

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      MESSAGES.BRAND.INVALID_BRAND_ID,
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_BRAND_ID
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      MESSAGES.BRAND.BRAND_NOT_FOUND,
      STATUS.NOT_FOUND,
      ERROR_CODES.BRAND_NOT_FOUND
    );
  }


  if (existingBrand.deletedAt !== null) {
    throw createError(
      MESSAGES.BRAND.BRAND_IS_ALREADY_DELETED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_ALREADY_DELETED
    );
  }

  
  existingBrand.isActive = false;
  existingBrand.deletedAt = new Date();

  await existingBrand.save();

  return {
    id: existingBrand._id,
    brandName: existingBrand.brandName,
    isActive: existingBrand.isActive,
    deletedAt: existingBrand.deletedAt,
  };
};


module.exports = {
  createBrand,
  updateBrand,
  getBrands,
  deleteBrand,
  toggleBrandStatus,
};