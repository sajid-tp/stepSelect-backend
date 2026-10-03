const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    otp: {
      type: Number,
      required: true,
    },

    type: {
      type: String,
      required: true,
    },
    newEmail : {
      type : String
    }
  },
  {
    timestamps: true,
  }
);

otpSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 300 }
);

module.exports = mongoose.model("OTP", otpSchema);