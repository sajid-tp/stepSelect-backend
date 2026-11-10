const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },

    image: { type: String, required: true },

    link: { type: String, default: '', trim: true, maxlength: 300 },

    displayOrder: { type: Number, default: 1, min: 1, max: 99 },

    isActive: { type: Boolean, default: true },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

bannerSchema.index({ deletedAt: 1, isActive: 1, displayOrder: 1 });

module.exports = mongoose.model('Banner', bannerSchema);
