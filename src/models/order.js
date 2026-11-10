const mongoose = require('mongoose');
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require('../constants/orderConstants');


const shippingAddressSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    addressType: { type: String, default: 'Home' },
    detailedAddress: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    pinCode: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    email: { type: String, default: '' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
   
    orderNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    shippingAddress: { type: shippingAddressSchema, required: true },

   
    subtotal: { type: Number, required: true, min: 0 },       
    discountTotal: { type: Number, default: 0, min: 0 },
    taxTotal: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },   
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    couponCode: { type: String, default: null },               
    couponDiscount: { type: Number, default: 0, min: 0 },       
    referralDiscount: { type: Number, default: 0, min: 0 },
    referralReward: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING, index: true },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHODS), default: PAYMENT_METHODS.COD },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },

    payment: {
      gateway: { type: String, default: null },
      gatewayOrderId: { type: String, default: null },
      paymentId: { type: String, default: null },
      currency: { type: String, default: null },
      chargedAmount: { type: Number, default: 0 },
      paidInr: { type: Number, default: 0 },
      refundedInr: { type: Number, default: 0 },
      attempts: { type: Number, default: 0 },
      attemptOpen: { type: Boolean, default: false },
      lastAttemptAt: { type: Date, default: null },
      lastFailedAt: { type: Date, default: null },
      attemptHistory: {
        type: [
          {
            reason: { type: String, default: null },
            paymentId: { type: String, default: null },
            failedAt: { type: Date, default: Date.now },
            _id: false,
          },
        ],
        default: [],
      },
      failedPaymentIds: { type: [String], default: [] },
      duplicatePaymentIds: { type: [String], default: [] },
      closedReason: { type: String, enum: ['expired', 'exhausted', 'abandoned', null], default: null },
      closedAt: { type: Date, default: null },
      failureReason: { type: String, default: null },
      refundError: { type: String, default: null },
      paidAt: { type: Date, default: null },
    },

    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
