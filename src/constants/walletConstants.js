// src/constants/walletConstants.js
// Everything about the wallet in one place.
//
// Wallet rules:
//   - Money gets IN only through Razorpay (top-up) or as a refund / reward.
//   - Money gets OUT only to pay for an order. There is no withdrawal and no refund to Razorpay.

const WALLET_TX_TYPE = Object.freeze({ CREDIT: 'credit', DEBIT: 'debit' });

// Why money moved. The wallet page shows a friendly label for each one.
const WALLET_SOURCE = Object.freeze({
  ADD_MONEY: 'ADD_MONEY',                       // customer added money through Razorpay
  ORDER_PAYMENT: 'ORDER_PAYMENT',               // customer paid an order with the wallet
  ORDER_CANCEL_REFUND: 'ORDER_CANCEL_REFUND',   // order / item cancelled: refunded straight away
  ORDER_RETURN_REFUND: 'ORDER_RETURN_REFUND',   // return approved by the admin
  REFERRAL_REWARD: 'REFERRAL_REWARD',           // a friend you referred got their first order delivered
});

// The only reasons money may leave the wallet
const WALLET_DEBIT_SOURCES = Object.freeze([WALLET_SOURCE.ORDER_PAYMENT]);

// State of one Razorpay top-up attempt
const WALLET_TOPUP_STATUS = Object.freeze({ CREATED: 'created', PAID: 'paid', FAILED: 'failed' });

// Rupee limits for a top-up
const WALLET_LIMITS = Object.freeze({
  MIN_TOP_UP: 100,
  MAX_TOP_UP: 50000,
  MAX_BALANCE: 100000,
});

module.exports = { WALLET_TX_TYPE, WALLET_SOURCE, WALLET_DEBIT_SOURCES, WALLET_TOPUP_STATUS, WALLET_LIMITS };
