// src/controllers/user/checkoutController.js
const checkoutService = require('../../services/user/checkoutService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  GET  /api/checkout   -> data = { addresses[], defaultAddressId, items[], subtotal, couponDiscount, total,
                                   walletBalance, pricing, paymentMethods, canPlaceOrder }
  POST /api/orders/cod   body: { shippingAddress (addressId), couponId? }        <- the Postman route
  POST /api/checkout/place-order   same handler, older route (also accepts { addressId, paymentMethod })
                       -> 201 data = { orderId, orderNumber, totalAmount, status:'placed', paymentMethod, paymentStatus }
  failure -> 4xx { success:false, message, error:{ code, message } }
*/

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

// GET /api/checkout
const getCheckoutSummary = async (req, res) => {
  const data = await checkoutService.getCheckoutSummary(getUserId(req));
  return res.status(STATUS.OK).json({ data });
};

// POST /api/checkout/place-order
const placeOrder = async (req, res) => {
  const { shippingAddress, addressId, couponId, paymentMethod } = req.body || {};
  const data = await checkoutService.placeOrder(getUserId(req), { shippingAddress, addressId, couponId, paymentMethod });
  return res.status(STATUS.CREATED).json({ message: MESSAGES.CHECKOUT.ORDER_PLACED_SUCCESSFULLY, data });
};

module.exports = { getCheckoutSummary, placeOrder };
