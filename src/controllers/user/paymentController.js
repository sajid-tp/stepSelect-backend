const paymentService = require('../../services/payment/paymentService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getUserId = (req) => {
  const id = req.user?.id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

// Start payment
const initiate = async (req, res) => {
  const { addressId, gateway } = req.body || {};
  const data = await paymentService.initiate(getUserId(req), { addressId, gateway });
  return res.status(STATUS.CREATED).json({ message: 'Payment started.', data });
};

// Wallet payment
const payWithWallet = async (req, res) => {
  const data = await paymentService.payWithWallet(getUserId(req), { addressId: (req.body || {}).addressId });
  return res.status(STATUS.CREATED).json({ message: 'Paid from your wallet.', data });
};

// Verify payment
const verifyRazorpay = async (req, res) => {
  const data = await paymentService.verifyRazorpay(getUserId(req), req.body || {});
  return res.status(STATUS.OK).json({ message: 'Payment successful.', data });
};

// Payment failure
const reportFailure = async (req, res) => {
  const { reason, paymentId } = req.body || {};
  const data = await paymentService.reportFailure(getUserId(req), req.params.orderNumber, reason, paymentId);
  return res.status(STATUS.OK).json({ data });
};

// Retry payment
const retry = async (req, res) => {
  const data = await paymentService.retry(getUserId(req), req.params.orderNumber, req.body || {});
  return res.status(STATUS.OK).json({ message: 'Payment restarted.', data });
};

// Abandon payment
const abandon = async (req, res) => {
  const data = await paymentService.abandon(getUserId(req), req.params.orderNumber);
  return res.status(STATUS.OK).json({ data });
};

// Payment status
const getStatus = async (req, res) => {
  const data = await paymentService.getStatus(getUserId(req), req.params.orderNumber);
  return res.status(STATUS.OK).json({ data });
};

// Razorpay webhook
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
  payWithWallet,
  verifyRazorpay,
  reportFailure,
  retry,
  abandon,
  getStatus,
  razorpayWebhook,
};
