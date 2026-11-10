const mongoose = require('mongoose');
const { WALLET_TOPUP_STATUS } = require('../constants/walletConstants');

const walletTopUpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },

    gateway: { type: String, default: 'RAZORPAY' },
    gatewayOrderId: { type: String, required: true, unique: true },
    paymentId: { type: String, default: null },

    status: { type: String, enum: Object.values(WALLET_TOPUP_STATUS), default: WALLET_TOPUP_STATUS.CREATED },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WalletTopUp', walletTopUpSchema);
