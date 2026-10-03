const Category = require('../../models/categories')
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


const getCategories = async ({ search, page = 1 }) => {
  
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = 5;

  const filter = {
    deletedAt : null
  };


  const searchText = (search || '').trim();
  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.categoryName = { $regex: escaped, $options: 'i' };
  }

  const totalResults = await Category.countDocuments(filter);
  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  const categories = await Category.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  const formattedCategories = categories.map((category) => ({
    id: category._id,
    categoryName: category.categoryName,
    iconClass: category.iconClass,
    description: category.description,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));

  return {
    categories: formattedCategories,
    totalResults,
    page: pageNum,
    limit: limitNum,
    totalPages,
  };
};



const createCategory = async ({ categoryName, iconClass, description }) => {
  const name = (categoryName || '').trim();

  if (!name) {
    throw createError('Category name is required.', 400, 'CATEGORY_NAME_REQUIRED');
  }

  const existingCategory = await Category.findOne({ categoryName: name })
    .collation({ locale: 'en', strength: 2 });

  if (existingCategory) {
    throw createError(
      'A category with this name already exists.',
      409,
      'CATEGORY_ALREADY_EXISTS'
    );
  }

  try {
    const category = await Category.create({
      categoryName: name,
      iconClass,
      description,
    });

    return {
      id: category._id,
      categoryName: category.categoryName,
      iconClass: category.iconClass,
      description: category.description,
      isActive: category.isActive,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  } catch (err) {
    if (err.code === 11000) {
      throw createError(
        'A category with this name already exists.',
        409,
        'CATEGORY_ALREADY_EXISTS'
      );
    }
    throw err;
  }
};



const updateCategory = async (
  categoryId,
  { categoryName, iconClass, description }
) => {
   
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
  throw createError(
    'Invalid category id.',
    400,
    'INVALID_CATEGORY_ID'
  );
}
  
  const existingCategory = await Category.findById(categoryId);


  if (!existingCategory) {
    throw createError(
      'Category not found.',
      404,
      'CATEGORY_NOT_FOUND'
    );
  }

  if (existingCategory.deletedAt !== null) {
  throw createError(
    'Cannot edit a deleted category.',
    400,
    'CATEGORY_DELETED'
  );
}
  
  if (!existingCategory.isActive) {
    throw createError(
      'Cannot edit an inactive category.',
      400,
      'CATEGORY_INACTIVE'
    );
  }

  const name = (categoryName || '').trim();

  if (!name) {
    throw createError(
      'Category name is required.',
      400,
      'CATEGORY_NAME_REQUIRED'
    );
  }

  const duplicateCategory = await Category.findOne({
    categoryName: name,
    _id: { $ne: categoryId },
  }).collation({
    locale: 'en',
    strength: 2,
  });

  if (duplicateCategory) {
    throw createError(
      'A category with this name already exists.',
      409,
      'CATEGORY_ALREADY_EXISTS'
    );
  }


  existingCategory.categoryName = name;
  existingCategory.iconClass = iconClass;
  existingCategory.description = description;

  const updatedCategory = await existingCategory.save();


  return {
    id: updatedCategory._id,
    categoryName: updatedCategory.categoryName,
    iconClass: updatedCategory.iconClass,
    description: updatedCategory.description,
    isActive: updatedCategory.isActive,
    createdAt: updatedCategory.createdAt,
    updatedAt: updatedCategory.updatedAt,
  };
};



const toggleCategoryStatus = async (categoryId) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError(
      'Invalid category id.',
      400,
      'INVALID_CATEGORY_ID'
    );
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(
      'Category not found.',
      404,
      'CATEGORY_NOT_FOUND'
    );
  }

  // Cannot activate/deactivate a deleted category
  if (existingCategory.deletedAt !== null) {
    throw createError(
      'Cannot change the status of a deleted category.',
      400,
      'CATEGORY_DELETED'
    );
  }

  // Toggle status
  existingCategory.isActive = !existingCategory.isActive;

  await existingCategory.save();

  return {
    id: existingCategory._id,
    categoryName: existingCategory.categoryName,
    isActive: existingCategory.isActive,
    deletedAt: existingCategory.deletedAt,
  };
};




const deleteCategory = async (categoryId) => {
 
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw createError('Invalid category id.', 400, 'INVALID_CATEGORY_ID');
  }

  const existingCategory = await Category.findById(categoryId);

  if (!existingCategory) {
    throw createError(
      'Category not found.',
      404,
      'CATEGORY_NOT_FOUND'
    );
  }

  // Already deleted
  if (existingCategory.deletedAt !== null) {
    throw createError(
      'Category is already deleted.',
      400,
      'CATEGORY_ALREADY_DELETED'
    );
  }

  // Soft delete
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
  createCategory,
  updateCategory,
  getCategories,
  deleteCategory,
  toggleCategoryStatus
}