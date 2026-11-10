const adminVariantService = require('../../services/admin/adminVariantServices');
const STATUS = require('../../constants/statusCodes');

// Get variants
const getVariants = async (req, res) => {
  const { productId } = req.params;
  const { page } = req.query;

  const data = await adminVariantService.getVariants(
    productId,
    {
      page,
      limit: 5,
    }
  );

  return res.status(STATUS.OK).json(data);
};


// Add variant
const addVariant = async (req, res) => {
  const { productId } = req.params;

  const {
    color,
    price,
    images,
    sizes,
  } = req.body;

  const data = await adminVariantService.addVariant(
    productId,
    {
      color,
      price,
      images,
      sizes,
    }
  );

  return res.status(STATUS.CREATED).json(data);
};


// Update variant
const updateVariant = async (req, res) => {
  const { variantId } = req.params;

  const {
    color,
    price,
    images,
    sizes,
  } = req.body;

  const data = await adminVariantService.updateVariant(
    variantId,
    {
      color,
      price,
      images,
      sizes,
    }
  );

  return res.status(STATUS.OK).json(data);
};


// Delete variant
const deleteVariant = async (req, res) => {
  const { variantId } = req.params;

  const data = await adminVariantService.deleteVariant(
    variantId
  );

  return res.status(STATUS.OK).json(data);
};


module.exports = {
  updateVariant,
  getVariants,
  deleteVariant,
  addVariant
};