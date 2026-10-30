const mongoose = require('mongoose');
const { REFERRAL_DEFAULTS } = require('../constants/offerConstants');

// The referral programme's rules. There is exactly ONE document (key = "default"),
// created the first time it is read. The admin edits it on the Offers page.
const referralSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    isActive: { type: Boolean, default: REFERRAL_DEFAULTS.isActive },
    // rupees off the referred friend's first order
    referredDiscount: { type: Number, default: REFERRAL_DEFAULTS.referredDiscount, min: 0 },
    // the first order must reach this amount (after product / category offers)
    minOrderAmount: { type: Number, default: REFERRAL_DEFAULTS.minOrderAmount, min: 0 },
    // rupees credited to the referrer's wallet when that first order is delivered
    referrerReward: { type: Number, default: REFERRAL_DEFAULTS.referrerReward, min: 0 },
  },
  { timestamps: true }
);

// Always returns the settings document (creates it with the defaults on first use)
referralSettingSchema.statics.getSettings = async function getSettings() {
  try {
    return await this.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) return this.findOne({ key: 'default' });
    throw err;
  }
};

module.exports = mongoose.model('ReferralSetting', referralSettingSchema);
