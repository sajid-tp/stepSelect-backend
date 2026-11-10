const couponService = require('../../services/admin/adminCouponServices');
const STATUS = require('../../constants/statusCodes');

// Get coupons
const getCoupons = async (req, res) => {
  const data = await couponService.getCoupons(req.query);
  return res.status(STATUS.OK).json(data);
};

// Create coupon
const createCoupon = async (req, res) => {
  const data = await couponService.createCoupon(req.body || {});
  return res.status(STATUS.CREATED).json(data);
};

// Get coupon
const getCouponById = async (req, res) => {
  const data = await couponService.getCouponById(req.params.couponId);
  return res.status(STATUS.OK).json(data);
};

// Update coupon
const updateCoupon = async (req, res) => {
  const data = await couponService.updateCoupon(req.params.couponId, req.body || {});
  return res.status(STATUS.OK).json(data);
};

// Coupon status
const setCouponStatus = async (req, res) => {
  const data = await couponService.setCouponStatus(
    req.params.couponId
  );

  return res.status(STATUS.OK).json(data);
};
// Delete coupon
const deleteCoupon = async (req, res) => {
  const data = await couponService.deleteCoupon(req.params.couponId);
  return res.status(STATUS.OK).json(data);
};

module.exports = { getCoupons, createCoupon, getCouponById, updateCoupon, setCouponStatus, deleteCoupon };
