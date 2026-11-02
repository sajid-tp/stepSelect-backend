// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  googleId: {
    type: String,
  },
  profileImage: {
    type: String,
  },
  password: {
    type: String,
  },
  phoneNumber :{
    type : String,
  },
  isVerified: {
     type: Boolean, default: false 
    },
  referralId: {
    type: String,
  },
  // Referral programme -------------------------------------------------
  // referralCode  : short code the customer shares ("SAJID-7K2Q"), typed in the signup form
  // referralToken : opaque token used in the invite link ("/invite/<token>")
  // referredBy    : the customer whose code / link this person signed up with
  referralCode: {
    type: String,
    uppercase: true,
    trim: true,
    unique: true,
    sparse: true,
  },
  referralToken: {
    type: String,
    lowercase: true,
    trim: true,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  termsAccepted: {
    type: Boolean,
    default: false,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true }); 

userSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { isVerified: false } }
)

module.exports = mongoose.model('User', userSchema);