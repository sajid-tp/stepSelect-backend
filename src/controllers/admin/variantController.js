const adminVariantService = require('../../services/admin/adminVariantServices');

const getVariants = async (req, res) => {
  try {

    const { productId } = req.params;
    const { page } = req.query;

    const data = await adminVariantService.getVariants(
      productId,
      {
        page,
        limit: 5,
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



const getVariant = async (req, res) => {
  try {

    const { variantId } = req.params;

    const data = await adminVariantService.getVariant(
      variantId
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


const addVariant = async (req, res) => {
  try {

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


const updateVariant = async (req, res) => {
  try {
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


const deleteVariant = async (req, res) => {
  try {

    const { variantId } = req.params;

    const data = await adminVariantService.deleteVariant(
      variantId
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


const toggleVariantStatus = async (req, res) => {
  try {

    const { variantId } = req.params;

    const data = await adminVariantService.toggleVariantStatus(
      variantId
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


module.exports = {
  updateVariant,
  getVariants,
  getVariant,
  deleteVariant,
  toggleVariantStatus,
  addVariant
};