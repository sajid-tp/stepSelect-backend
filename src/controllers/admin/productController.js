const adminProductService = require('../../services/admin/adminProductServices');
const STATUS = require('../../constants/statusCodes');


const getProducts = async (req, res) => {
  const {
    search,
    page,
    sort,
    status,
  } = req.query;

  const data = await adminProductService.getProducts({
    search,
    page,
    sort,
    status,
    limit: 5,
  });

  return res.status(STATUS.OK).json(data);
};

const getProduct = async (req, res) => {
  const { productId } = req.params;

  const data = await adminProductService.getProduct(
    productId
  );

  return res.status(STATUS.OK).json(data);
};


const createProduct = async (req, res) => {
  const {
    productName,
    description,
    categoryId,
    brandId,
    gender,
    variants,
  } = req.body;


  const data = await adminProductService.createProduct({
    productName,
    description,
    gender,
    categoryId,
    brandId,
    variants,
  });


  return res.status(STATUS.CREATED).json(data);
};


const updateProduct = async (req, res) => {
  const { productId } = req.params;

  const {
    productName,
    description,
    categoryId,
    gender,
    brandId,
  } = req.body;


  const data = await adminProductService.updateProduct(
    productId,
    {
      productName,
      description,
      categoryId,
      gender,
      brandId,
    }
  );


  return res.status(STATUS.OK).json(data);
};


const deleteProduct = async (req, res) => {
  const { productId } = req.params;

  const data = await adminProductService.deleteProduct(
    productId
  );

  return res.status(STATUS.OK).json(data);
};



const toggleProductStatus = async (req, res) => {
  const { productId } = req.params;

  const data = await adminProductService.toggleProductStatus(
    productId
  );

  return res.status(STATUS.OK).json(data);
};



module.exports = {
  createProduct,
  updateProduct,
  getProducts,
  getProduct,
  deleteProduct,
  toggleProductStatus
};