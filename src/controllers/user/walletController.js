const walletService = require('../../services/user/walletService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  GET  /api/wallet?type=credit|debit&page=1&limit=10   -> data { balance, transactions[], pagination, topUpEnabled, limits }
  POST /api/wallet/add-money   { amount }              -> data { balance, transaction }   (demo top-up)
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

const addMoney = async (req, res) => {
  const data = await walletService.addMoney(getUserId(req), (req.body || {}).amount);
  return res.status(STATUS.CREATED).json({ message: 'Money added to your wallet.', data });
};

module.exports = { getWallet, addMoney };
