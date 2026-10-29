// src/constants/walletConstants.js
// Everything about the wallet in one place.

const WALLET_TX_TYPE = Object.freeze({ CREDIT: 'credit', DEBIT: 'debit' });

// Why money moved. The wallet page shows a friendly label for each one.
const WALLET_SOURCE = Object.freeze({
  ADD_MONEY: 'ADD_MONEY',                       // customer topped up (demo)
  ORDER_PAYMENT: 'ORDER_PAYMENT',               // customer paid an order with the wallet
  ORDER_CANCEL_REFUND: 'ORDER_CANCEL_REFUND',   // order / item cancelled: refunded straight away
  ORDER_RETURN_REFUND: 'ORDER_RETURN_REFUND',   // return approved by the admin
});

// Rupee limits for the demo top-up
const WALLET_LIMITS = Object.freeze({
  MIN_TOP_UP: 1,
  MAX_TOP_UP: 50000,
  MAX_BALANCE: 100000,
});

module.exports = { WALLET_TX_TYPE, WALLET_SOURCE, WALLET_LIMITS };
