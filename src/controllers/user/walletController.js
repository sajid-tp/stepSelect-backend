const walletService = require('../../services/user/walletService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  GET  /api/wallet?type=credit|debit&page=1&limit=10
        -> data { balance, transactions[], pagination, topUpEnabled, razorpayDemo, limits }

  Money can only be added through Razorpay, and it can never be taken back out
  (there is no withdraw / refund-to-Razorpay endpoint on purpose).

  POST /api/wallet/top-up/initiate  { amount }
        -> data { topUpId, gateway, amountInr, key, razorpayOrderId, amount(paise), currency, demo? }   (opens the Razorpay popup)
  POST /api/wallet/top-up/verify    { razorpay_order_id, razorpay_payment_id, razorpay_signature }
        -> data { balance, transaction, amount }                                      (money is added here)
*/

const getUserId = (req) => {
  const id = req.user?.id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const getWallet = async (req, res) => {
  const { type, page, limit } = req.query || {};
  const data = await walletService.getWallet(getUserId(req), { type, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const initiateTopUp = async (req, res) => {
  const data = await walletService.initiateTopUp(getUserId(req), (req.body || {}).amount);
  return res.status(STATUS.CREATED).json({ message: 'Payment started.', data });
};

const verifyTopUp = async (req, res) => {
  const data = await walletService.verifyTopUp(getUserId(req), req.body || {});
  return res.status(STATUS.OK).json({ message: 'Money added to your wallet.', data });
};

module.exports = { getWallet, initiateTopUp, verifyTopUp };
