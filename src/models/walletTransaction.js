const mongoose = require('mongoose');
const { WALLET_TX_TYPE, WALLET_SOURCE } = require('../constants/walletConstants');

// One row of the wallet history. Rows are only ever added, never edited or deleted.
// Amounts are in PAISE (see models/wallet.js).
const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(WALLET_TX_TYPE), required: true },
    source: { type: String, enum: Object.values(WALLET_SOURCE), required: true },
    amountPaise: { type: Number, required: true, min: 1 },

    // Wallet balance right after this row. Stays null until the balance was really changed,
    // so a half-finished row never shows in the history.
    balanceAfterPaise: { type: Number, default: null },

    description: { type: String, default: '' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: null },

    // Makes sure the same refund / payment can never be applied twice
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
