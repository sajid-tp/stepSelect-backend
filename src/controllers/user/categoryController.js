const STATUS = require('../../constants/statusCodes');
const categoryService =
  require('../../services/user/categoryService');


// GET /api/categories
const getCategories = async (req, res) => {
  const data =
    await categoryService.getCategories();


  return res.status(STATUS.OK).json({
    data: {
      categories: data,
    },
  });

};


module.exports = {
  getCategories,
};