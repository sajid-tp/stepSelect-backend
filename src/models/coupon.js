const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    couponCode: {
      type: String,
      required: [true, 'Coupon code is required'],
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 40,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      required: [true, 'Discount type is required'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [0.01, 'Discount value must be greater than zero'],
    },
    maximumDiscount: {
      type: Number,
      min: [0, 'Maximum discount cannot be negative'],
      default: null,
    },
    minimumPurchase: {
      type: Number,
      min: [0, 'Minimum purchase cannot be negative'],
      default: 0,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    // Maximum number of successful orders that may redeem this coupon. null = unlimited.
    redemptionLimit: {
      type: Number,
      min: [1, 'Redemption limit must be at least 1'],
      default: null,
    },
    // Maximum successful redemptions per user. Defaults to one use per customer.
    usageLimitPerUser: {
      type: Number,
      min: [1, 'Per-user usage limit must be at least 1'],
      default: 1,
    },
    // Increment this only when an order is successfully placed with the coupon.
    usedCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

couponSchema.pre('validate', function () {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    this.invalidate('discountValue', 'Percentage discount cannot exceed 100');
  }

  if (this.discountType === 'flat' && this.maximumDiscount != null) {
    this.invalidate('maximumDiscount', 'Maximum discount is only applicable to percentage coupons');
  }

  if (this.startDate && this.expiryDate && this.expiryDate < this.startDate) {
    this.invalidate('expiryDate', 'Expiry date must be on or after the start date');
  }
});

couponSchema.index(
  { couponCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
    },
  }
);
couponSchema.index({ deletedAt: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Coupon', couponSchema);
