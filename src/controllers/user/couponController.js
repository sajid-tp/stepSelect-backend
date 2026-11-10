const couponService = require('../../services/user/couponService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

// Get coupons
const getCoupons = async (req, res) => {
  const data = await couponService.getAvailableCoupons(getUserId(req));
  return res.status(STATUS.OK).json({ data });
};

// Apply coupon
const applyCoupon = async (req, res) => {
  const { couponCode } = req.body || {};
  const data = await couponService.applyCoupon(getUserId(req), couponCode);
  return res.status(STATUS.OK).json({ message: MESSAGES.COUPON.COUPON_APPLIED, data });
};

// Remove coupon
const removeCoupon = async (req, res) => {
  const data = await couponService.removeCoupon(getUserId(req));
  return res.status(STATUS.OK).json({ message: MESSAGES.COUPON.COUPON_REMOVED, data });
};

module.exports = { getCoupons, applyCoupon, removeCoupon };
