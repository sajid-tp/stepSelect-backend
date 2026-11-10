// src/services/user/walletService.js
// The customer wallet: balance, history, Razorpay top-up, and the two money moves
// (creditWallet / debitWallet) that the rest of the backend uses for refunds and payments.
//
// Rules:
//   IN  : only through Razorpay (top-up), or as a refund / reward.
//   OUT : only to pay for an order. There is no withdrawal and nothing is ever sent back to Razorpay.
const mongoose = require('mongoose');
const Wallet = require('../../models/wallet');
const WalletTransaction = require('../../models/walletTransaction');
const WalletTopUp = require('../../models/walletTopUp');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const {
  WALLET_TX_TYPE,
  WALLET_SOURCE,
  WALLET_DEBIT_SOURCES,
  WALLET_TOPUP_STATUS,
  WALLET_LIMITS,
} = require('../../constants/walletConstants');
const razorpay = require('../payment/gateways/razorpay');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Money is stored in paise (integers). Only this file converts.
const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const toRupees = (paise) => (Number(paise) || 0) / 100;

// Adding money is on whenever Razorpay is set up (real test keys, or the built-in demo popup)
const topUpEnabled = () => razorpay.isConfigured();

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
// Only paying for an order may take money out; any other reason is refused.
const debitWallet = async (userId, rupees, meta = {}) => {
  if (!WALLET_DEBIT_SOURCES.includes(meta.source)) {
    throw createError('Money cannot be taken out of the wallet.', STATUS.FORBIDDEN);
  }
  return applyEntry(userId, WALLET_TX_TYPE.DEBIT, rupees, meta);
};

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
    razorpayDemo: razorpay.isDemo(),
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
// Add money through Razorpay
// ---------------------------------------------------------------
//   1. initiateTopUp -> checks the amount, saves a WalletTopUp row, creates the Razorpay order
//   2. customer pays in the Razorpay popup
//   3. verifyTopUp   -> checks Razorpay's signature, then credits the wallet (once only)
//      (the webhook does the same, for customers who pay and then close the browser)
// The amount that is credited is the one saved in step 1, never one sent by the browser.

const validateTopUpAmount = (amount) => {
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
  return rupees;
};

const initiateTopUp = async (userId, amount) => {
  if (!razorpay.isConfigured()) {
    throw createError('Adding money to the wallet is not available right now.', STATUS.SERVICE_UNAVAILABLE);
  }

  const rupees = validateTopUpAmount(amount);

  // The id is made first so it can go on the Razorpay receipt (max 40 characters)
  const topUpId = new mongoose.Types.ObjectId();
  const session = await razorpay.createGatewayOrder({
    amountInr: rupees,
    receipt: `wallet_${topUpId}`,
    notes: { purpose: 'wallet_top_up', userId: String(userId) },
  });

  await WalletTopUp.create({
    _id: topUpId,
    userId,
    amountPaise: toPaise(rupees),
    gateway: razorpay.name,
    gatewayOrderId: session.gatewayOrderId,
  });

  // `amount` (paise) comes from clientData: it is what the Razorpay popup needs. `amountInr` is for display.
  return { topUpId: String(topUpId), gateway: razorpay.name, amountInr: rupees, ...session.clientData };
};

// Credit the wallet for a paid top-up. Safe to call twice (verify + webhook): the idempotency key
// makes sure the money is added only once.
const settleTopUp = async (topUp, paymentId) => {
  const result = await creditWallet(topUp.userId, toRupees(topUp.amountPaise), {
    source: WALLET_SOURCE.ADD_MONEY,
    description: `Money added via Razorpay${paymentId ? ` (${paymentId})` : ''}`,
    idempotencyKey: `wallet-topup:${topUp._id}`,
  });

  await WalletTopUp.updateOne(
    { _id: topUp._id, status: { $ne: WALLET_TOPUP_STATUS.PAID } },
    { $set: { status: WALLET_TOPUP_STATUS.PAID, paymentId, paidAt: new Date(), failureReason: null } }
  );

  const balance = result.duplicate ? await getBalance(topUp.userId) : result.balance;
  return { balance, transaction: result.transaction, amount: toRupees(topUp.amountPaise) };
};

const markTopUpFailed = (topUp, reason) =>
  WalletTopUp.updateOne(
    { _id: topUp._id, status: WALLET_TOPUP_STATUS.CREATED },
    { $set: { status: WALLET_TOPUP_STATUS.FAILED, failureReason: String(reason || 'Payment failed').slice(0, 200) } }
  );

// The Razorpay popup returned a payment: check its signature, then add the money
const verifyTopUp = async (userId, body = {}) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

  const topUp = await WalletTopUp.findOne({ gatewayOrderId: String(razorpay_order_id || ''), userId });
  if (!topUp) throw createError('We could not find this payment.', STATUS.NOT_FOUND);

  const valid = razorpay.verifySignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!valid) {
    await markTopUpFailed(topUp, 'Payment verification failed');
    throw createError('We could not verify your payment.', STATUS.BAD_REQUEST);
  }

  return settleTopUp(topUp, razorpay_payment_id);
};

// Razorpay webhook for a wallet top-up (called from paymentService when the order is not a shop order)
const handleTopUpWebhook = async (eventName, payment) => {
  const topUp = await WalletTopUp.findOne({ gatewayOrderId: payment?.order_id });
  if (!topUp) return { handled: false };

  if (eventName === 'payment.captured' || eventName === 'order.paid') {
    // Only credit when Razorpay says it received exactly the amount we asked for
    if (payment.amount !== undefined && Number(payment.amount) !== topUp.amountPaise) {
      console.error('Wallet top-up amount mismatch', String(topUp._id));
      return { handled: true };
    }
    await settleTopUp(topUp, payment.id).catch((err) => console.error('Webhook wallet top-up:', err.message));
  } else if (eventName === 'payment.failed') {
    await markTopUpFailed(topUp, payment.error_description);
  }
  return { handled: true };
};

module.exports = {
  getWallet,
  getBalance,
  initiateTopUp,
  verifyTopUp,
  handleTopUpWebhook,
  creditWallet,
  debitWallet,
  toRupees,
  toPaise,
};
