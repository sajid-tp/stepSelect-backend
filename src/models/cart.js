const mongoose = require('mongoose');

// A cart line is identified by variantId + size (a variant = one color,
// and the stock lives per size inside that variant).
// Price, name and image are NOT stored here: they are read live from the
// variant/product every time, so the cart never shows an outdated price.
const cartItemSchema = new mongoose.Schema(
  {
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
    size: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    // one cart per user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
