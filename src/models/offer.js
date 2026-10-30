const mongoose = require('mongoose');
const { OFFER_TYPE, OFFER_LIMITS } = require('../constants/offerConstants');

// One percentage-off offer, either on a single product or on a whole category.
// When a shoe has both, the shopper gets the larger of the two (see services/user/offerService.js).
const offerSchema = new mongoose.Schema(
  {
    offerName: {
      type: String,
      required: [true, 'Offer name is required'],
      trim: true,
      minlength: 3,
      maxlength: 80,
    },
    offerType: {
      type: String,
      enum: Object.values(OFFER_TYPE),
      required: [true, 'Offer type is required'],
    },
    // Only one of these is filled, depending on offerType
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', default: null },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },

    discountPercent: {
      type: Number,
      required: [true, 'Discount is required'],
      min: [OFFER_LIMITS.MIN_PERCENT, `Discount must be at least ${OFFER_LIMITS.MIN_PERCENT}%`],
      max: [OFFER_LIMITS.MAX_PERCENT, `Discount cannot be more than ${OFFER_LIMITS.MAX_PERCENT}%`],
    },

    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: [true, 'Expiry date is required'] },

    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

offerSchema.pre('validate', function () {
  if (this.offerType === OFFER_TYPE.PRODUCT) {
    if (!this.productId) this.invalidate('productId', 'Choose a product for this offer');
    this.categoryId = null;
  }
  if (this.offerType === OFFER_TYPE.CATEGORY) {
    if (!this.categoryId) this.invalidate('categoryId', 'Choose a category for this offer');
    this.productId = null;
  }
  if (this.startDate && this.expiryDate && this.expiryDate < this.startDate) {
    this.invalidate('expiryDate', 'Expiry date must be on or after the start date');
  }
});

offerSchema.index({ deletedAt: 1, isActive: 1, offerType: 1, expiryDate: 1 });
offerSchema.index({ productId: 1 });
offerSchema.index({ categoryId: 1 });

module.exports = mongoose.model('Offer', offerSchema);
