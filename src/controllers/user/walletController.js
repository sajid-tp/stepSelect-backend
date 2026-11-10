const walletService = require('../../services/user/walletService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getUserId = (req) => {
  const id = req.user?.id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

// Get wallet
const getWallet = async (req, res) => {
  const { type, page, limit } = req.query || {};
  const data = await walletService.getWallet(getUserId(req), { type, page, limit });
  return res.status(STATUS.OK).json({ data });
};

// Start top-up
const initiateTopUp = async (req, res) => {
  const data = await walletService.initiateTopUp(getUserId(req), (req.body || {}).amount);
  return res.status(STATUS.CREATED).json({ message: 'Payment started.', data });
};

// Verify top-up
const verifyTopUp = async (req, res) => {
  const data = await walletService.verifyTopUp(getUserId(req), req.body || {});
  return res.status(STATUS.OK).json({ message: 'Money added to your wallet.', data });
};

module.exports = { getWallet, initiateTopUp, verifyTopUp };
