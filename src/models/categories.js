const mongoose = require('mongoose');

const categorySchema = mongoose.Schema(
  {
    categoryName: {
      type: String,
      required: true,
      trim: true,
    },

    iconClass: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
      trim : true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    deletedAt:{
      type : Date,
      default : null,
    }
  },
  { timestamps: true }
);

// Case-insensitive unique category name
categorySchema.index(
  { categoryName: 1 },
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

module.exports = mongoose.model('Category', categorySchema);
