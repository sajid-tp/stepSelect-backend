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


// GET /api/admin/brands
const getBrands = async ({ search, page = 1 }) => {

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

  const totalResults = await Brand.countDocuments(filter);

  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  const brands = await Brand.find(filter)
    .sort({ createdAt: -1 })
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


// POST /api/admin/brands
const createBrand = async ({
  brandName,
  description,
  logo,
}) => {

  const name = (brandName || '').trim();


  if (!name) {
    throw createError(
      'Brand name is required.',
      400,
      'BRAND_NAME_REQUIRED'
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
      'A brand with this name already exists.',
      409,
      'BRAND_ALREADY_EXISTS'
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
        'A brand with this name already exists.',
        409,
        'BRAND_ALREADY_EXISTS'
      );
    }

    throw err;
  }
};


// PATCH /api/admin/brands/:brandId
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
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      'Brand not found.',
      404,
      'BRAND_NOT_FOUND'
    );
  }

  if (existingBrand.deletedAt !== null) {
    throw createError(
      'Cannot edit a deleted brand.',
      400,
      'BRAND_DELETED'
    );
  }

  if (!existingBrand.isActive) {
    throw createError(
      'Cannot edit an inactive brand.',
      400,
      'BRAND_INACTIVE'
    );
  }

  const name = (brandName || '').trim();

  if (!name) {
    throw createError(
      'Brand name is required.',
      400,
      'BRAND_NAME_REQUIRED'
    );
  }


  // Check duplicate brand name
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
      'A brand with this name already exists.',
      409,
      'BRAND_ALREADY_EXISTS'
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
        'A brand with this name already exists.',
        409,
        'BRAND_ALREADY_EXISTS'
      );
    }

    throw err;
  }
};


// PATCH /api/admin/brands/:brandId/status
const toggleBrandStatus = async (brandId) => {

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      'Brand not found.',
      404,
      'BRAND_NOT_FOUND'
    );
  }

  // Cannot activate/deactivate a deleted brand
  if (existingBrand.deletedAt !== null) {
    throw createError(
      'Cannot change the status of a deleted brand.',
      400,
      'BRAND_DELETED'
    );
  }

  // Toggle status
  existingBrand.isActive = !existingBrand.isActive;

  await existingBrand.save();

  return {
    id: existingBrand._id,
    brandName: existingBrand.brandName,
    isActive: existingBrand.isActive,
    deletedAt: existingBrand.deletedAt,
  };
};


// DELETE /api/admin/brands/:brandId
const deleteBrand = async (brandId) => {

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw createError(
      'Invalid brand id.',
      400,
      'INVALID_BRAND_ID'
    );
  }

  const existingBrand = await Brand.findById(brandId);

  if (!existingBrand) {
    throw createError(
      'Brand not found.',
      404,
      'BRAND_NOT_FOUND'
    );
  }

  // Already deleted
  if (existingBrand.deletedAt !== null) {
    throw createError(
      'Brand is already deleted.',
      400,
      'BRAND_ALREADY_DELETED'
    );
  }

  // Soft delete
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