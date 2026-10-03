const mongoose = require('mongoose');

const sizeSchema = mongoose.Schema(
  {
    size: {
      type: String,
      required: true,
    },

    stock: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

const variantSchema = mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'product',
      required: true,
    },

    size: {
      type: [sizeSchema],
      required: true,
    },

    color: {
      type: String,
      required: true,
      trim: true,
    },

    images: {
      type: [String],
      required: true,
      validate: {
        validator: function (val) {
          return val.length >= 3;
        },
        message: 'A variant must have minimum 3 images',
      },
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('variant', variantSchema);

