const adminVariantService = require('../../services/admin/adminVariantServices');

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

module.exports = {
  updateVariant,
};