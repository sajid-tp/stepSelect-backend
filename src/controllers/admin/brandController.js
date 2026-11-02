const adminBrandService = require('../../services/admin/adminBrandServices');
const STATUS = require('../../constants/statusCodes');



const getBrands = async (req, res) => {
  const { search, page, sort } = req.query;

  const data = await adminBrandService.getBrands({
    search,
    page,
    limit: 5,
    sort
  });

  return res.status(STATUS.OK).json(data);
};



const createBrand = async (req, res) => {
  const {
    brandName,
    description,
    logo,
  } = req.body;

  const data = await adminBrandService.createBrand({
    brandName,
    description,
    logo,
  });

  return res.status(STATUS.CREATED).json(data);
};



const updateBrand = async (req, res) => {
  const { brandId } = req.params;

  const {
    brandName,
    description,
    logo,
  } = req.body;

  const data = await adminBrandService.updateBrand(
    brandId,
    {
      brandName,
      description,
      logo,
    }
  );

  return res.status(STATUS.OK).json(data);
};



const toggleBrandStatus = async (req, res) => {
  const { brandId } = req.params;

  const data =
    await adminBrandService.toggleBrandStatus(brandId);

  return res.status(STATUS.OK).json(data);
};



const deleteBrand = async (req, res) => {
  const { brandId } = req.params;

  const data =
    await adminBrandService.deleteBrand(brandId);

  return res.status(STATUS.OK).json(data);
};


module.exports = {
  createBrand,
  updateBrand,
  getBrands,
  deleteBrand,
  toggleBrandStatus,
};