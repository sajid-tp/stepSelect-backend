const STATUS = require('../../constants/statusCodes');
const brandService =
  require('../../services/user/brandService');


// Get brands
const getBrands = async (req, res) => {
  const data =
    await brandService.getBrands();


  return res.status(STATUS.OK).json({
    data: {
      brands: data,
    },
  });

};


module.exports = {
  getBrands,
};