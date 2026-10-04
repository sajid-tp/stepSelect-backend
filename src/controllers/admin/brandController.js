const adminBrandService = require('../../services/admin/adminBrandServices');


// GET /api/admin/brands
const getBrands = async (req, res) => {
  try {

    const { search, page } = req.query;

    const data = await adminBrandService.getBrands({
      search,
      page,
      limit: 5,
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


// POST /api/admin/brands
const createBrand = async (req, res) => {
  try {

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


// PATCH /api/admin/brands/:brandId
const updateBrand = async (req, res) => {
  try {

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


// PATCH /api/admin/brands/:brandId/status
const toggleBrandStatus = async (req, res) => {
  try {

    const { brandId } = req.params;

    const data =
      await adminBrandService.toggleBrandStatus(brandId);

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


// DELETE /api/admin/brands/:brandId
const deleteBrand = async (req, res) => {
  try {

    const { brandId } = req.params;

    const data =
      await adminBrandService.deleteBrand(brandId);

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


module.exports = {
  createBrand,
  updateBrand,
  getBrands,
  deleteBrand,
  toggleBrandStatus,
};