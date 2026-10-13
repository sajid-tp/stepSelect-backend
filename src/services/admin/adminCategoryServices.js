// src/services/admin/adminCategoryServices.js
const Category = require('../../models/categories');
const mongoose = require('mongoose');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

// Sort options allowed from the frontend
const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { categoryName: 1 },
  name_desc: { categoryName: -1 },
};

// Shape of a category sent back to the frontend
const formatCategory = (category) => ({
  id: category._id,
  categoryName: category.categoryName,
  iconClass: category.iconClass,
  description: category.description,
  isActive: category.isActive,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

// 1. Get Paginated, Searched & Sorted Categories
const getCategories = async ({ search, page = 1, sort }) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = 8;

  // Hide soft-deleted categories
  const filter = { deletedAt: null };

  // Search filtering (special regex characters are escaped)
  const searchText = (search || '').trim();
  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.categoryName = { $regex: escaped, $options: 'i' };
  }

  // Sorting (falls back to newest, _id keeps the order stable)
  const sortOption = {
    ...(SORT_MAP[sort] || SORT_MAP.newest),
    _id: -1,
  };

  // Count total matches
  const totalResults = await Category.countDocuments(filter);
  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  // Fetch paginated documents
  const categories = await Category.find(filter)
    .sort(sortOption)
    .collation({ locale: 'en', strength: 2 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  return {
    categories: categories.map(formatCategory),
    totalResults,
    page: pageNum,
    limit: limitNum,
    totalPages,
  };
};

// 2. Create Category
const createCategory = async ({ categoryName, iconClass, description }) => {
  const name = (categoryName || '').trim();

  if (!name) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NAME_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_NAME_REQUIRED);
  }

  if (name.length < 3) {
    throw createError(
      MESSAGES.CATEGORY.CATEGORY_NAME_IS_REQUIRED_WITH_ATLEAST_3_CHARACTERS,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CATEGORY_NAME_REQUIRED
    );
  }

  // Duplicate check (case-insensitive, ignores deleted categories)
  const existingCategory = await Category.findOne({
    categoryName: name,
    deletedAt: null,
  }).collation({ locale: 'en', strength: 2 });

  if (existingCategory) {
    throw createError(
      MESSAGES.CATEGORY.A_CATEGORY_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.CATEGORY_ALREADY_EXISTS
    );
  }

  try {
    const category = await Category.create({
      categoryName: name,
      iconClass,
      description,
    });

    return formatCategory(category);
  } catch (err) {
    // 11000 = unique index error from MongoDB
    if (err.code === 11000) {
      throw createError(
        MESSAGES.CATEGORY.A_CATEGORY_WITH_THIS_NAME_ALREADY_EXISTS,
        STATUS.CONFLICT,
        ERROR_CODES.CATEGORY_ALREADY_EXISTS
      );
    }
    throw err;
  }
};

// 3. Update Category
const updateCategory = async (categoryId, { categoryName, iconClass, description }) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(MESSAGES.CATEGORY.INVALID_CATEGORY_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_CATEGORY_ID);
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.CATEGORY_NOT_FOUND);
  }

  if (existingCategory.deletedAt !== null) {
    throw createError(MESSAGES.CATEGORY.CANNOT_EDIT_A_DELETED_CATEGORY, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_DELETED);
  }

  if (!existingCategory.isActive) {
    throw createError(MESSAGES.CATEGORY.CANNOT_EDIT_AN_INACTIVE_CATEGORY, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_INACTIVE);
  }

  const name = (categoryName || '').trim();

  if (!name) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NAME_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_NAME_REQUIRED);
  }

  // Duplicate check (ignores this category itself and deleted ones)
  const duplicateCategory = await Category.findOne({
    categoryName: name,
    deletedAt: null,
    _id: { $ne: categoryId },
  }).collation({ locale: 'en', strength: 2 });

  if (duplicateCategory) {
    throw createError(
      MESSAGES.CATEGORY.A_CATEGORY_WITH_THIS_NAME_ALREADY_EXISTS,
      STATUS.CONFLICT,
      ERROR_CODES.CATEGORY_ALREADY_EXISTS
    );
  }

  existingCategory.categoryName = name;
  existingCategory.iconClass = iconClass;
  existingCategory.description = description;

  const updatedCategory = await existingCategory.save();

  return formatCategory(updatedCategory);
};

// 4. Toggle Category Active/Inactive Status
const toggleCategoryStatus = async (categoryId) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(MESSAGES.CATEGORY.INVALID_CATEGORY_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_CATEGORY_ID);
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.CATEGORY_NOT_FOUND);
  }

  // A deleted category cannot be activated/deactivated
  if (existingCategory.deletedAt !== null) {
    throw createError(
      MESSAGES.CATEGORY.CANNOT_CHANGE_THE_STATUS_OF_A_DELETED_CATEGORY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CATEGORY_DELETED
    );
  }

  existingCategory.isActive = !existingCategory.isActive;
  await existingCategory.save();

  return {
    id: existingCategory._id,
    categoryName: existingCategory.categoryName,
    isActive: existingCategory.isActive,
    deletedAt: existingCategory.deletedAt,
  };
};

// 5. Delete Category (soft delete)
const deleteCategory = async (categoryId) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(MESSAGES.CATEGORY.INVALID_CATEGORY_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_CATEGORY_ID);
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.CATEGORY_NOT_FOUND);
  }

  if (existingCategory.deletedAt !== null) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_IS_ALREADY_DELETED, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_ALREADY_DELETED);
  }

  existingCategory.isActive = false;
  existingCategory.deletedAt = new Date();

  await existingCategory.save();

  return {
    id: existingCategory._id,
    categoryName: existingCategory.categoryName,
    isActive: existingCategory.isActive,
    deletedAt: existingCategory.deletedAt,
  };
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  deleteCategory,
};
