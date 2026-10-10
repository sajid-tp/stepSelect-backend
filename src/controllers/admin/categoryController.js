// POST /api/admin/categories
const adminCategoryService = require('../../services/admin/adminCategoryServices')


const getCategories = async (req, res) => {
  try {
    const { search, page, sort="newest" } = req.query;

    const data = await adminCategoryService.getCategories({
      search,
      page,
      limit: 5,
      sort
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);

    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};

const createCategory = async (req, res) => {
  try {
    const { categoryName, iconClass, description } = req.body;

    const data = await adminCategoryService.createCategory({
      categoryName,
      iconClass,
      description,
    });

    return res.status(201).json(data);
  } catch (err) {
    console.error(err);

    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const { categoryName, iconClass, description } = req.body;

    const data = await adminCategoryService.updateCategory(categoryId, {
      categoryName,
      iconClass,
      description,
    });

    console.log("data");

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);

    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};



const toggleCategoryStatus = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const data =
      await adminCategoryService.toggleCategoryStatus(categoryId);

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);

    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};




const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const data = await adminCategoryService.deleteCategory(categoryId);

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);

    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};




module.exports = {createCategory,updateCategory, getCategories,deleteCategory, toggleCategoryStatus}