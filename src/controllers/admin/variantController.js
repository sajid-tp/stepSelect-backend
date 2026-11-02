const adminVariantService = require('../../services/admin/adminVariantServices');
const STATUS = require('../../constants/statusCodes');

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


const deleteVariant = async (req, res) => {
  const { variantId } = req.params;

  const data = await adminVariantService.deleteVariant(
    variantId
  );

  return res.status(STATUS.OK).json(data);
};


// const toggleVariantStatus = async (req, res) => {
//   const { variantId } = req.params;

//   const data = await adminVariantService.toggleVariantStatus(
//     variantId
//   );

//   return res.status(STATUS.OK).json(data);
// };


module.exports = {
  updateVariant,
  getVariants,
  deleteVariant,
  // toggleVariantStatus,
  addVariant
};