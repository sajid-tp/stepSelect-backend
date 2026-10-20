const mongoose = require('mongoose');
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require('../constants/orderConstants');

// Copy of the address at the time of ordering (the user may edit/delete the address later)
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
    // Readable unique ID shown to the user, e.g. ORD-20261020-A3F9C2
    orderNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    shippingAddress: { type: shippingAddressSchema, required: true },

    // Money. These are recalculated from the active (non-cancelled) items when an item is cancelled.
    subtotal: { type: Number, required: true, min: 0 },       // sum of original price x qty
    discountTotal: { type: Number, default: 0, min: 0 },
    taxTotal: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },    // what the customer pays

    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },

    status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING, index: true },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHODS), default: PAYMENT_METHODS.COD },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },

    // Shown on the order details and success screens
    estimatedDelivery: { type: Date, default: null },
    // Set by the admin (PATCH /api/admin/orders/:orderId)
    carrier: { type: String, default: '', trim: true },
    trackingId: { type: String, default: '', trim: true },

    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
