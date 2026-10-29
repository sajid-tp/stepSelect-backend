const mongoose = require('mongoose');

// One wallet per customer. The balance is kept in PAISE (whole numbers) so that
// adding and subtracting money never produces 0.30000000000000004 style errors.
const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balancePaise: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
