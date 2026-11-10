const mongoose = require('mongoose');
const { REFERRAL_DEFAULTS } = require('../constants/offerConstants');

const referralSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    isActive: { type: Boolean, default: REFERRAL_DEFAULTS.isActive },
    referredDiscount: { type: Number, default: REFERRAL_DEFAULTS.referredDiscount, min: 0 },
    minOrderAmount: { type: Number, default: REFERRAL_DEFAULTS.minOrderAmount, min: 0 },
    referrerReward: { type: Number, default: REFERRAL_DEFAULTS.referrerReward, min: 0 },
  },
  { timestamps: true }
);

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
