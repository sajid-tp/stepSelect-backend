const mongoose = require('mongoose');

const productSchema = mongoose.Schema(
  {
    productName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
    },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },

    gender: { 
      type: String, 
      enum: ['men', 'women', 'unisex'], 
      required: true 
    },
    
    isActive: {
      type: Boolean,
      default: true,
    },

     deletedAt:{
      type : Date,
      default : null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('product', productSchema);

