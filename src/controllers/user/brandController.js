const brandService =
  require('../../services/user/brandService');


// GET /api/brands
const getBrands = async (req, res) => {

  try {

    const data =
      await brandService.getBrands();


    return res.status(200).json({
      data: {
        brands: data,
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
  getBrands,
};