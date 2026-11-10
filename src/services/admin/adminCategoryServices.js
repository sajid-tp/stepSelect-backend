const Category = require('../../models/categories');
const mongoose = require('mongoose');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { ICON_CLASS_LIMITS, ICON_CLASS_REGEX, NAME_LIMITS, DESCRIPTION_LIMITS } = require('../../constants/categoryConstants');

const validateIconClass = (value) => {
  const icon = String(value ?? '').trim().replace(/\s+/g, ' ');
  const { MIN_LENGTH, MAX_LENGTH } = ICON_CLASS_LIMITS;
  let message = '';
  if (!icon) message = 'Icon class is required';
  else if (icon.length < MIN_LENGTH || icon.length > MAX_LENGTH)
    message = `Icon class must be ${MIN_LENGTH} to ${MAX_LENGTH} characters`;
  else if (!ICON_CLASS_REGEX.test(icon))
    message = 'Icon class can only contain letters, numbers, spaces and hyphens';
  if (message) throw createError(message, STATUS.BAD_REQUEST, 'INVALID_ICON_CLASS');
  return icon;
};


const validateCategoryName = (value) => {
  const name = (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ');
  const { MIN_LENGTH, MAX_LENGTH } = NAME_LIMITS;
  if (!name) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NAME_IS_REQUIRED, STATUS.BAD_REQUEST, ERROR_CODES.CATEGORY_NAME_REQUIRED);
  }
  if (name.length < MIN_LENGTH) {
    throw createError(`Category name must be at least ${MIN_LENGTH} characters.`, STATUS.BAD_REQUEST, 'INVALID_CATEGORY_NAME');
  }
  if (name.length > MAX_LENGTH) {
    throw createError(`Category name cannot exceed ${MAX_LENGTH} characters.`, STATUS.BAD_REQUEST, 'INVALID_CATEGORY_NAME');
  }
  return name;
};


const validateDescription = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw createError('Description must be text', STATUS.BAD_REQUEST, 'INVALID_CATEGORY_DESCRIPTION');
  }
  const description = value.trim().replace(/\s+/g, ' ');
  const { MAX_LENGTH } = DESCRIPTION_LIMITS;
  if (description.length > MAX_LENGTH) {
    throw createError(`Description cannot exceed ${MAX_LENGTH} characters`, STATUS.BAD_REQUEST, 'INVALID_CATEGORY_DESCRIPTION');
  }
  return description;
};

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { categoryName: 1 },
  name_desc: { categoryName: -1 },
};


const formatCategory = (category) => ({
  id: category._id,
  categoryName: category.categoryName,
  iconClass: category.iconClass,
  description: category.description,
  isActive: category.isActive,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

// Get categories
const getCategories = async ({ search, page = 1, sort, status, limit }) => {

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 100);

  const filter = { deletedAt: null };

  const searchText = (search || '').trim();
  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.categoryName = { $regex: escaped, $options: 'i' };
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

  const totalResults = await Category.countDocuments(filter);
  const totalPages = Math.ceil(totalResults / limitNum) || 1;

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



// Create category
const createCategory = async ({ categoryName, iconClass, description }) => {
  const name = validateCategoryName(categoryName);

  const icon = validateIconClass(iconClass);
  const cleanDescription = validateDescription(description);

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
      iconClass: icon,
      description: cleanDescription,
    });

    return formatCategory(category);
  } catch (err) {
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



// Update category
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

  const name = validateCategoryName(categoryName);

  const icon = validateIconClass(iconClass);
  const cleanDescription = validateDescription(description);

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
  existingCategory.iconClass = icon;
  existingCategory.description = cleanDescription;

  const updatedCategory = await existingCategory.save();

  return formatCategory(updatedCategory);
};

// Category status
const toggleCategoryStatus = async (categoryId) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(MESSAGES.CATEGORY.INVALID_CATEGORY_ID, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_CATEGORY_ID);
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.CATEGORY_NOT_FOUND);
  }

  if (existingCategory.deletedAt !== null) {
    throw createError(
      MESSAGES.CATEGORY.CANNOT_CHANGE_THE_STATUS_OF_A_DELETED_CATEGORY,
      STATUS.BAD_REQUEST,
      ERROR_CODES.CATEGORY_DELETED
    );
  }

  existingCategory.isActive = !existingCategory.isActive;
  await existingCategory.save({ validateModifiedOnly: true });

  return formatCategory(existingCategory)
};

// Delete category
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

  await existingCategory.save({ validateModifiedOnly: true });

  return formatCategory(existingCategory)
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  toggleCategoryStatus,
  deleteCategory,
};
