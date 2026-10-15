
const adminCategoryService = require('../../services/admin/adminCategoryServices')
const STATUS = require('../../constants/statusCodes');

//get categories
const getCategories = async (req, res) => {
  const { search, page, sort="newest",status } = req.query;

  const data = await adminCategoryService.getCategories({
    search,
    page,
    sort,
    status
  });

  return res.status(STATUS.OK).json(data);
};



//create categories
const createCategory = async (req, res) => {
  const { categoryName, iconClass, description } = req.body;

  const data = await adminCategoryService.createCategory({
    categoryName,
    iconClass,
    description,
  });

  return res.status(STATUS.CREATED).json(data);
};



//update categories
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


//toggleCategoryStatus
const toggleCategoryStatus = async (req, res) => {
  const { categoryId } = req.params;

  const data =
    await adminCategoryService.toggleCategoryStatus(categoryId);

  return res.status(STATUS.OK).json(data);
};



//deleteCategory
const deleteCategory = async (req, res) => {
  const { categoryId } = req.params;

  const data = await adminCategoryService.deleteCategory(categoryId);

  return res.status(STATUS.OK).json(data);
};




module.exports = {createCategory,updateCategory, getCategories,deleteCategory, toggleCategoryStatus}