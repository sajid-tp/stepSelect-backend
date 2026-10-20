// src/controllers/user/checkoutController.js
const checkoutService = require('../../services/user/checkoutService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  GET  /api/checkout   -> data = { addresses[], defaultAddressId, items[], pricing, paymentMethods, canPlaceOrder }
  POST /api/checkout/place-order   body: { addressId?, paymentMethod? ('COD') }
                       -> 201 data = { orderId, orderNumber, totalAmount, paymentMethod }
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
  const { addressId, shippingAddress, paymentMethod } = req.body || {};
  // Postman user-side COD request calls the selected address `shippingAddress`.
  // Keep `addressId` supported for the checkout endpoint as well.
  const selectedAddressId = addressId || shippingAddress;
  const data = await checkoutService.placeOrder(getUserId(req), {
    addressId: selectedAddressId,
    paymentMethod: paymentMethod || 'COD',
  });
  return res.status(STATUS.CREATED).json({ message: MESSAGES.CHECKOUT.ORDER_PLACED_SUCCESSFULLY, data });
};

module.exports = { getCheckoutSummary, placeOrder };
