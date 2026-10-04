const adminProductService = require('../../services/admin/adminProductServices');


// POST /api/admin/products
const createProduct = async (req, res) => {
  try {

    const {
      productName,
      description,
      categoryId,
      brandId,
      variants,
    } = req.body;


    const data = await adminProductService.createProduct({
      productName,
      description,
      categoryId,
      brandId,
      variants,
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


const updateProduct = async (req, res) => {
  try {

    const { productId } = req.params;

    const {
      productName,
      description,
      categoryId,
      brandId,
    } = req.body;


    const data = await adminProductService.updateProduct(
      productId,
      {
        productName,
        description,
        categoryId,
        brandId,
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
  createProduct,
  updateProduct
};