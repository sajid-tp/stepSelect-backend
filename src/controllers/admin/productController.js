const adminProductService = require('../../services/admin/adminProductServices');



const getProducts = async (req, res) => {
  try {

    const {
      search,
      page,
    } = req.query;

    const data = await adminProductService.getProducts({
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

const getProduct = async (req, res) => {
  try {

    const { productId } = req.params;

    const data = await adminProductService.getProduct(
      productId
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


const deleteProduct = async (req, res) => {
  try {

    const { productId } = req.params;

    const data = await adminProductService.deleteProduct(
      productId
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



const toggleProductStatus = async (req, res) => {
  try {

    const { productId } = req.params;

    const data = await adminProductService.toggleProductStatus(
      productId
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
  updateProduct,
  getProducts,
  getProduct,
  deleteProduct,
  toggleProductStatus
};