const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema(
  {
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'variant', required: true },
    size: { type: String, required: true, trim: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: { type: [wishlistItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wishlist', wishlistSchema);
