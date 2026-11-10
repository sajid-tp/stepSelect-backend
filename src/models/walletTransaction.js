const mongoose = require('mongoose');
const { WALLET_TX_TYPE, WALLET_SOURCE } = require('../constants/walletConstants');

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(WALLET_TX_TYPE), required: true },
    source: { type: String, enum: Object.values(WALLET_SOURCE), required: true },
    amountPaise: { type: Number, required: true, min: 1 },

    balanceAfterPaise: { type: Number, default: null },

    description: { type: String, default: '' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: null },

    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
