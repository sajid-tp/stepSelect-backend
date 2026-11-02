const userProductService = require('../../services/user/productService');
const STATUS = require('../../constants/statusCodes');

// GET /api/products
const getProducts = async (req, res) => {
  const { search, category, brand, gender, minPrice, maxPrice, sort, page, limit } = req.query;

  const data = await userProductService.getProducts({
    search,
    category,
    brand,
    gender,
    minPrice,
    maxPrice,
    sort,
    page,
    limit,
  });

  return res.status(STATUS.OK).json({ data });
};

// GET /api/products/:productId
const getProduct = async (req, res) => {
  const { productId } = req.params;

  const data = await userProductService.getProduct(productId);

  return res.status(STATUS.OK).json({ data });
};



// GET /api/products/:productId/related?limit=4
const getRelatedProducts = async (req, res) => {
  const data = await userProductService.getRelatedProducts(
    req.params.productId,
    req.query.limit
  );
  return res.status(STATUS.OK).json({ data });
};

module.exports = {
  getProducts,
  getProduct,
  getRelatedProducts
};