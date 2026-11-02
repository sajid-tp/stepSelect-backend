const mongoose = require('mongoose');
const { WALLET_TOPUP_STATUS } = require('../constants/walletConstants');

// One row per "Add money" attempt. It is created on the SERVER before Razorpay opens, so the amount
// that gets credited is always the amount stored here, never a number sent back by the browser.
// Amounts are in PAISE (see models/wallet.js).
const walletTopUpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },

    gateway: { type: String, default: 'RAZORPAY' },
    gatewayOrderId: { type: String, required: true, unique: true }, // Razorpay order id
    paymentId: { type: String, default: null },                     // Razorpay payment id once paid

    status: { type: String, enum: Object.values(WALLET_TOPUP_STATUS), default: WALLET_TOPUP_STATUS.CREATED },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WalletTopUp', walletTopUpSchema);
