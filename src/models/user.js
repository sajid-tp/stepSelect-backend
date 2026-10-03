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