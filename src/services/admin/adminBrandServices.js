const Brand = require('../../models/brands');
const mongoose = require('mongoose');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { NAME_LIMITS, DESCRIPTION_LIMITS } = require('../../constants/brandConstants');

const validateBrandName = (value) => {
  const name = (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ');
  const { MIN_LENGTH, MAX_LENGTH } = NAME_LIMITS;
  if (!name) {
    throw createError(
      MESSAGES.BRAND.BRAND_NAME_IS_REQUIRED,
      STATUS.BAD_REQUEST,
      ERROR_CODES.BRAND_NAME_REQUIRED
    );
  }
  if (name.length < MIN_LENGTH) {
    throw createError(`Brand name must be at least ${MIN_LENGTH} characters.`, STATUS.BAD_REQUEST, 'INVALID_BRAND_NAME');
  }
  if (name.length > MAX_LENGTH) {
    throw createError(`Brand name cannot exceed ${MAX_LENGTH} characters.`, STATUS.BAD_REQUEST, 'INVALID_BRAND_NAME');
  }
  return name;
};

const validateDescription = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw createError('Description must be text.', STATUS.BAD_REQUEST, 'INVALID_BRAND_DESCRIPTION');
  }
  const text = value.trim();
  const { MAX_LENGTH } = DESCRIPTION_LIMITS;
  if (text.length > MAX_LENGTH) {
    throw createError(`Description cannot exceed ${MAX_LENGTH} characters.`, STATUS.BAD_REQUEST, 'INVALID_BRAND_DESCRIPTION');
  }
  return text;
};

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { brandName: 1 },
  name_desc: { brandName: -1 },
};




// Get brands
const getBrands = async ({ search, page = 1, sort, status, limit }) => {

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 100);

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


  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }

  const sortOption = {
    ...(SORT_MAP[sort] || SORT_MAP.newest),
    _id: -1,
  };

  const totalResults = await Brand.countDocuments(filter);

  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  const brands = await Brand.find(filter)
    .sort(sortOption)
    .collation({ locale: 'en', strength: 2 })
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





// Create brand
const createBrand = async ({
  brandName,
  description,
  logo,
}) => {

  const name = validateBrandName(brandName);


  const descriptionText = validateDescription(description);


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
      description: descriptionText,
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





// Update brand
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

  const name = validateBrandName(brandName);


  const descriptionText = validateDescription(description);


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
  existingBrand.description = descriptionText;
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




// Brand status
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



// Delete brand
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