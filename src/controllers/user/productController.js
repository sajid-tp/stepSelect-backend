const userProductService = require('../../services/user/productService');

// GET /api/products
const getProducts = async (req, res) => {
  try {
    const { search, category, brand, minPrice, maxPrice, sort, page, limit } = req.query;

    const data = await userProductService.getProducts({
      search,
      category,
      brand,
      minPrice,
      maxPrice,
      sort,
      page,
      limit,
    });

    return res.status(200).json({ data });
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

// GET /api/products/:productId
const getProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const data = await userProductService.getProduct(productId);

    return res.status(200).json({ data });
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
  getProducts,
  getProduct,
};