const mongoose = require('mongoose');
const { COUPON_LIMITS } = require('../constants/couponConstants');

const couponSchema = new mongoose.Schema(
  {
    couponCode: {
      type: String,
      required: [true, 'Coupon code is required'],
      trim: true,
      uppercase: true,
      minlength: COUPON_LIMITS.CODE_MIN_LENGTH,
      maxlength: COUPON_LIMITS.CODE_MAX_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: COUPON_LIMITS.DESCRIPTION_MAX_LENGTH,
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
      max: [COUPON_LIMITS.MAX_FLAT_DISCOUNT, 'Discount value is too large'],
    },
    maximumDiscount: {
      type: Number,
      min: [COUPON_LIMITS.MIN_DISCOUNT_CAP, 'Maximum discount must be at least ₹1'],
      default: null,
    },
    minimumPurchase: {
      type: Number,
      min: [COUPON_LIMITS.MIN_PURCHASE_MIN, 'Minimum purchase cannot be negative'],
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
    redemptionLimit: {
      type: Number,
      min: [COUPON_LIMITS.MIN_REDEMPTION_LIMIT, 'Redemption limit must be at least 1'],
      default: null,
    },

    usageLimitPerUser: {
      type: Number,
      min: [COUPON_LIMITS.MIN_USES_PER_CUSTOMER, 'Per-user usage limit must be at least 1'],
      max: [COUPON_LIMITS.MAX_USES_PER_CUSTOMER, 'Per-user usage limit cannot exceed 5'],
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
  // Only on new coupons or when the value/type changes, so an older coupon can still be activated/deactivated
  if (
    this.discountType === 'percentage' &&
    this.discountValue > COUPON_LIMITS.MAX_PERCENT &&
    (this.isNew || this.isModified('discountValue') || this.isModified('discountType'))
  ) {
    this.invalidate('discountValue', `Percentage discount cannot exceed ${COUPON_LIMITS.MAX_PERCENT}`);
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
