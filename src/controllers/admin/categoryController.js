const adminCategoryService = require('../../services/admin/adminCategoryServices')
const STATUS = require('../../constants/statusCodes');

// Get categories
const getCategories = async (req, res) => {
  const { search, page, sort="newest",status, limit } = req.query;

  const data = await adminCategoryService.getCategories({
    search,
    page,
    sort,
    status,
    limit
  });

  return res.status(STATUS.OK).json(data);
};



// Create category
const createCategory = async (req, res) => {
  const { categoryName, iconClass, description } = req.body;

  const data = await adminCategoryService.createCategory({
    categoryName,
    iconClass,
    description,
  });

  return res.status(STATUS.CREATED).json(data);
};



// Update category
const updateCategory = async (req, res) => {
  const { categoryId } = req.params;

  const { categoryName, iconClass, description } = req.body;

  const data = await adminCategoryService.updateCategory(categoryId, {
    categoryName,
    iconClass,
    description,
  });

  console.log("data");

  return res.status(STATUS.OK).json(data);
};


// Category status
const toggleCategoryStatus = async (req, res) => {
  const { categoryId } = req.params;

  const data =
    await adminCategoryService.toggleCategoryStatus(categoryId);

  return res.status(STATUS.OK).json(data);
};



// Delete category
const deleteCategory = async (req, res) => {
  const { categoryId } = req.params;

  const data = await adminCategoryService.deleteCategory(categoryId);

  return res.status(STATUS.OK).json(data);
};




module.exports = {createCategory,updateCategory, getCategories,deleteCategory, toggleCategoryStatus}