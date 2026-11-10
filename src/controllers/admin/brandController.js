const adminBrandService = require('../../services/admin/adminBrandServices');
const STATUS = require('../../constants/statusCodes');



// Get brands
const getBrands = async (req, res) => {
  const { search, page, sort, status, limit } = req.query;

  const data = await adminBrandService.getBrands({
    search,
    page,
    limit,
    sort,
    status
  });

  return res.status(STATUS.OK).json(data);
};



// Create brand
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



// Update brand
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



// Brand status
const toggleBrandStatus = async (req, res) => {
  const { brandId } = req.params;

  const data =
    await adminBrandService.toggleBrandStatus(brandId);

  return res.status(STATUS.OK).json(data);
};



// Delete brand
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