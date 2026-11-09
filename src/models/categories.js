const mongoose = require('mongoose');
const { ICON_CLASS_LIMITS } = require('../constants/categoryConstants');

const categorySchema = mongoose.Schema(
  {
    categoryName: {
      type: String,
      required: true,
      trim: true,
    },

    // Required/format rules are enforced in adminCategoryServices. Toggle / delete save with validateModifiedOnly,
    // so older categories with an empty or short icon class can still be toggled and deleted.
    iconClass: {
      type: String,
      trim: true,
      minlength: ICON_CLASS_LIMITS.MIN_LENGTH,
      maxlength: ICON_CLASS_LIMITS.MAX_LENGTH,
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
