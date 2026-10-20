const mongoose = require('mongoose');
const { ITEM_STATUS } = require('../constants/orderConstants');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// One order line = one variant (colour) + one size, with a SNAPSHOT of what the user saw
// when buying. Later edits to the product never change old orders.
const orderItemSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'variant', required: true },

    // Snapshot fields
    name: { type: String, required: true },
    color: { type: String, default: '' },
    size: { type: String, required: true },
    image: { type: String, default: null },
    price: { type: Number, required: true, min: 0 },          // original unit price
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    finalPrice: { type: Number, required: true, min: 0 },    // unit price after discount
    quantity: { type: Number, required: true, min: 1 },

    // Money for the whole line (final price x quantity, and its share of tax)
    itemTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: Object.values(ITEM_STATUS), default: ITEM_STATUS.PENDING },
    statusHistory: { type: [statusHistorySchema], default: [] },

    cancelledQuantity: { type: Number, default: 0 },
    deliveredQuantity: { type: Number, default: 0 },
    returnedQuantity: { type: Number, default: 0 },

    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    returnReason: { type: String, default: null },
    returnDescription: { type: String, default: null },
    returnRequestedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OrderItem', orderItemSchema);
