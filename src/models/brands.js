const mongoose = require('mongoose');

const brandSchema = mongoose.Schema(
  {
    brandName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
    },

    logo: {
      type: String,
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
  {
    timestamps: true,
  }
);

// Case-insensitive unique brand name
brandSchema.index(
  { brandName: 1 },
  {
    unique: true,
    collation: {
      locale: 'en',
      strength: 2,
    },
    partialFilterExpression: {
      deletedAt: { $type: 'null' },
    },
  }
);

const brandModel = mongoose.model('Brand', brandSchema);

module.exports = brandModel;