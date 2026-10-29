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


const orderItemSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'variant', required: true },


    name: { type: String, required: true },
    color: { type: String, default: '' },
    size: { type: String, required: true },
    image: { type: String, default: null },
    price: { type: Number, required: true, min: 0 },          
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    finalPrice: { type: Number, required: true, min: 0 },   
    quantity: { type: Number, required: true, min: 1 },

    
    itemTotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    
    couponShare: { type: Number, default: 0, min: 0 },

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
    
    returnRequestedQuantity: { type: Number, default: 0 },

    returnRejectReason: { type: String, default: null },
    returnRejectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OrderItem', orderItemSchema);
