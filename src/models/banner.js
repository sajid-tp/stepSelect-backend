const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },

    // Cloudinary url of the banner picture
    image: { type: String, required: true },

    // Where a click on the banner goes (optional). A shop path like /shop or a full https:// link.
    link: { type: String, default: '', trim: true, maxlength: 300 },

    // Position in the hero slider: 1 is shown first
    displayOrder: { type: Number, default: 1, min: 1, max: 99 },

    // false = hidden from the landing page
    isActive: { type: Boolean, default: true },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

bannerSchema.index({ deletedAt: 1, isActive: 1, displayOrder: 1 });

module.exports = mongoose.model('Banner', bannerSchema);
