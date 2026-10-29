
const checkoutService = require('../../services/user/checkoutService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');



const getUserId = (req) => {
  const id = req.user?.id 
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};


const getCheckoutSummary = async (req, res) => {
  const data = await checkoutService.getCheckoutSummary(getUserId(req));
  return res.status(STATUS.OK).json({ data });
};

 

const placeOrder = async (req, res) => {
  const { addressId, paymentMethod } = req.body || {};
  const selectedAddressId = addressId;
  const data = await checkoutService.placeOrder(getUserId(req), {
    addressId: selectedAddressId,
    paymentMethod: paymentMethod || 'COD',
  });
  return res.status(STATUS.CREATED).json({ message: MESSAGES.CHECKOUT.ORDER_PLACED_SUCCESSFULLY, data });
};

module.exports = { getCheckoutSummary, placeOrder };
