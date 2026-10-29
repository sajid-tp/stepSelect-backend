// src/services/user/walletService.js
// The customer wallet: balance, history, demo top-up, and the two money moves
// (creditWallet / debitWallet) that the rest of the backend uses for refunds and payments.
const Wallet = require('../../models/wallet');
const WalletTransaction = require('../../models/walletTransaction');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const { WALLET_TX_TYPE, WALLET_SOURCE, WALLET_LIMITS } = require('../../constants/walletConstants');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Money is stored in paise (integers). Only this file converts.
const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const toRupees = (paise) => (Number(paise) || 0) / 100;

const topUpEnabled = () => String(process.env.WALLET_DEMO_TOPUP).toLowerCase() === 'true';

// Every customer has exactly one wallet; it is created the first time it is needed.
const ensureWallet = async (userId) => {
  try {
    return await Wallet.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, balancePaise: 0 } },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    // Two requests created it at the same moment: the wallet exists now, just read it
    if (err.code === 11000) return Wallet.findOne({ userId });
    throw err;
  }
};

const toTransactionView = (tx) => ({
  id: String(tx._id),
  type: tx.type,
  source: tx.source,
  amount: toRupees(tx.amountPaise),
  balanceAfter: toRupees(tx.balanceAfterPaise),
  description: tx.description,
  orderNumber: tx.orderNumber || null,
  createdAt: tx.createdAt,
});

// ---------------------------------------------------------------
// The one place that changes a balance
// ---------------------------------------------------------------
// 1. write the history row (the unique idempotencyKey stops a repeat)
// 2. change the balance in ONE atomic update (a debit only matches while enough money is there)
// 3. put the new balance on the history row
const applyEntry = async (userId, type, rupees, meta = {}) => {
  const paise = toPaise(rupees);
  if (!(paise > 0)) throw createError('The amount must be more than zero.', STATUS.BAD_REQUEST);

  await ensureWallet(userId);

  let tx;
  try {
    tx = await WalletTransaction.create({
      userId,
      type,
      source: meta.source,
      amountPaise: paise,
      description: meta.description || '',
      orderId: meta.orderId || null,
      orderNumber: meta.orderNumber || null,
      idempotencyKey: meta.idempotencyKey || undefined,
    });
  } catch (err) {
    // Same key again: this money move already happened, so do nothing a second time
    if (err.code === 11000 && meta.idempotencyKey) {
      const existing = await WalletTransaction.findOne({ idempotencyKey: meta.idempotencyKey });
      return { duplicate: true, transaction: existing ? toTransactionView(existing) : null };
    }
    throw err;
  }

  try {
    const filter = type === WALLET_TX_TYPE.DEBIT ? { userId, balancePaise: { $gte: paise } } : { userId };
    const change = type === WALLET_TX_TYPE.DEBIT ? -paise : paise;

    const wallet = await Wallet.findOneAndUpdate(filter, { $inc: { balancePaise: change } }, { returnDocument: 'after' });
    if (!wallet) throw createError('Your wallet balance is not enough for this payment.', STATUS.BAD_REQUEST);

    tx.balanceAfterPaise = wallet.balancePaise;
    await tx.save();

    return { duplicate: false, transaction: toTransactionView(tx), balance: toRupees(wallet.balancePaise) };
  } catch (err) {
    await WalletTransaction.deleteOne({ _id: tx._id }).catch(() => {}); // nothing moved: remove the row
    throw err;
  }
};

// Money INTO the wallet (refunds, top-ups)
const creditWallet = (userId, rupees, meta) => applyEntry(userId, WALLET_TX_TYPE.CREDIT, rupees, meta);

// Money OUT of the wallet (paying an order). Throws 400 when the balance is too low.
const debitWallet = (userId, rupees, meta) => applyEntry(userId, WALLET_TX_TYPE.DEBIT, rupees, meta);

const getBalance = async (userId) => {
  const wallet = await ensureWallet(userId);
  return toRupees(wallet.balancePaise);
};

// ---------------------------------------------------------------
// Wallet page: balance + history (newest first, optional credit / debit filter, pages)
// ---------------------------------------------------------------
const getWallet = async (userId, { type, page, limit } = {}) => {
  const wallet = await ensureWallet(userId);

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = { userId, balanceAfterPaise: { $ne: null } };
  if (Object.values(WALLET_TX_TYPE).includes(type)) filter.type = type;

  const [totalItems, rows] = await Promise.all([
    WalletTransaction.countDocuments(filter),
    WalletTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
  ]);

  return {
    balance: toRupees(wallet.balancePaise),
    topUpEnabled: topUpEnabled(),
    limits: WALLET_LIMITS,
    transactions: rows.map(toTransactionView),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

// ---------------------------------------------------------------
// Demo top-up: no real payment, the money is added straight away.
// Only works while WALLET_DEMO_TOPUP=true in .env.
// ---------------------------------------------------------------
const addMoney = async (userId, amount) => {
  if (!topUpEnabled()) {
    throw createError('Adding money to the wallet is not available right now.', STATUS.FORBIDDEN);
  }

  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw createError('Enter a valid amount.', STATUS.BAD_REQUEST);
  }
  if (Math.abs(rupees * 100 - Math.round(rupees * 100)) > 1e-6) {
    throw createError('The amount can have at most 2 decimal places.', STATUS.BAD_REQUEST);
  }
  if (rupees < WALLET_LIMITS.MIN_TOP_UP) {
    throw createError(`The minimum amount is ₹${WALLET_LIMITS.MIN_TOP_UP}.`, STATUS.BAD_REQUEST);
  }
  if (rupees > WALLET_LIMITS.MAX_TOP_UP) {
    throw createError(`You can add up to ₹${WALLET_LIMITS.MAX_TOP_UP.toLocaleString('en-IN')} at a time.`, STATUS.BAD_REQUEST);
  }

  const balance = await getBalance(userId);
  if (balance + rupees > WALLET_LIMITS.MAX_BALANCE) {
    throw createError(
      `The wallet can hold up to ₹${WALLET_LIMITS.MAX_BALANCE.toLocaleString('en-IN')}.`,
      STATUS.BAD_REQUEST
    );
  }

  const result = await creditWallet(userId, rupees, {
    source: WALLET_SOURCE.ADD_MONEY,
    description: 'Money added to wallet',
  });

  return { balance: result.balance, transaction: result.transaction };
};

module.exports = {
  getWallet,
  getBalance,
  addMoney,
  creditWallet,
  debitWallet,
  toRupees,
  toPaise,
};
