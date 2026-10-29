const paymentService = require('../../services/payment/paymentService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  POST /api/payments/initiate                  { addressId, gateway }   -> data { orderNumber, gateway, ...gateway data }
<<<<<<< HEAD
  POST /api/payments/wallet/pay                { addressId }            -> data = payment status (order is paid at once)
=======
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
  POST /api/payments/razorpay/verify           { orderNumber, razorpay_order_id, razorpay_payment_id, razorpay_signature }
  POST /api/payments/:orderNumber/failed       { reason }
  POST /api/payments/:orderNumber/retry        { gateway? }
  POST /api/payments/:orderNumber/abandon
  GET  /api/payments/:orderNumber/status
  POST /api/payments/webhook/razorpay          (called by Razorpay, no login)
*/

const getUserId = (req) => {
  const id = req.user?.id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const initiate = async (req, res) => {
  const { addressId, gateway } = req.body || {};
  const data = await paymentService.initiate(getUserId(req), { addressId, gateway });
  return res.status(STATUS.CREATED).json({ message: 'Payment started.', data });
};

<<<<<<< HEAD
const payWithWallet = async (req, res) => {
  const data = await paymentService.payWithWallet(getUserId(req), { addressId: (req.body || {}).addressId });
  return res.status(STATUS.CREATED).json({ message: 'Paid from your wallet.', data });
};

=======
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
const verifyRazorpay = async (req, res) => {
  const data = await paymentService.verifyRazorpay(getUserId(req), req.body || {});
  return res.status(STATUS.OK).json({ message: 'Payment successful.', data });
};

const reportFailure = async (req, res) => {
  const data = await paymentService.reportFailure(getUserId(req), req.params.orderNumber, (req.body || {}).reason);
  return res.status(STATUS.OK).json({ data });
};

const retry = async (req, res) => {
  const data = await paymentService.retry(getUserId(req), req.params.orderNumber, req.body || {});
  return res.status(STATUS.OK).json({ message: 'Payment restarted.', data });
};

const abandon = async (req, res) => {
  const data = await paymentService.abandon(getUserId(req), req.params.orderNumber);
  return res.status(STATUS.OK).json({ data });
};

const getStatus = async (req, res) => {
  const data = await paymentService.getStatus(getUserId(req), req.params.orderNumber);
  return res.status(STATUS.OK).json({ data });
};

const razorpayWebhook = async (req, res) => {
  const data = await paymentService.handleRazorpayWebhook(
    req.rawBody,
    req.headers['x-razorpay-signature'],
    req.body
  );
  return res.status(STATUS.OK).json({ data });
};

module.exports = {
  initiate,
<<<<<<< HEAD
  payWithWallet,
=======
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
  verifyRazorpay,
  reportFailure,
  retry,
  abandon,
  getStatus,
  razorpayWebhook,
};
