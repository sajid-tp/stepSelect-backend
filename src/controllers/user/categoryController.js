const categoryService =
  require('../../services/user/categoryService');


// GET /api/categories
const getCategories = async (req, res) => {

  try {

    const data =
      await categoryService.getCategories();


    return res.status(200).json({
      data: {
        categories: data,
      },
    });

  } catch (err) {

    console.error(err);

    return res.status(
      err.statusCode || 500
    ).json({

      error: {

        code:
          err.code ||
          'SERVER_ERROR',

        message:
          err.message ||
          'Something went wrong.',

      },

    });

  }

};


module.exports = {
  getCategories,
};