const mongoose = require('mongoose');
const Coupon = require('../../models/coupon');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');

const ALLOWED_FIELDS = [
  'couponCode',
  'description',
  'discountType',
  'discountValue',
  'maximumDiscount',
  'minimumPurchase',
  'startDate',
  'expiryDate',
  'redemptionLimit',
  'usageLimitPerUser',
  'isActive',
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const validateCouponInput = (data, { creating = false } = {}) => {
  if (creating) {
    for (const field of ['couponCode', 'discountType', 'discountValue']) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        throw createError(`${field} is required`, STATUS.BAD_REQUEST, 'COUPON_FIELD_REQUIRED');
      }
    }
  }

  if (data.couponCode !== undefined) {
    if (typeof data.couponCode !== 'string' || !data.couponCode.trim()) {
      throw createError('Coupon code must be a non-empty string', STATUS.BAD_REQUEST, 'INVALID_COUPON_CODE');
    }
    data.couponCode = data.couponCode.trim().toUpperCase();
  }

  if (data.discountType !== undefined && !['percentage', 'flat'].includes(data.discountType)) {
    throw createError('discountType must be percentage or flat', STATUS.BAD_REQUEST, 'INVALID_DISCOUNT_TYPE');
  }

  if (data.discountValue !== undefined) {
    const value = Number(data.discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw createError('discountValue must be a number greater than zero', STATUS.BAD_REQUEST, 'INVALID_DISCOUNT_VALUE');
    }
    data.discountValue = value;
  }

  const type = data.discountType;
  const value = data.discountValue;
  if (type === 'percentage' && value !== undefined && value > 100) {
    throw createError('Percentage discount cannot exceed 100', STATUS.BAD_REQUEST, 'INVALID_DISCOUNT_VALUE');
  }
  if (type === 'flat' && data.maximumDiscount != null) {
    throw createError('maximumDiscount can only be used with percentage coupons', STATUS.BAD_REQUEST, 'INVALID_MAXIMUM_DISCOUNT');
  }

  for (const field of ['maximumDiscount', 'minimumPurchase', 'redemptionLimit', 'usageLimitPerUser']) {
    if (data[field] !== undefined && data[field] !== null) {
      const valueNum = Number(data[field]);
      const min = field === 'redemptionLimit' || field === 'usageLimitPerUser' ? 1 : 0;
      if (!Number.isFinite(valueNum) || valueNum < min || (['redemptionLimit', 'usageLimitPerUser'].includes(field) && !Number.isInteger(valueNum))) {
        throw createError(`${field} must be a valid number`, STATUS.BAD_REQUEST, 'INVALID_COUPON_LIMIT');
      }
      data[field] = valueNum;
    }
  }

  for (const field of ['startDate', 'expiryDate']) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
      const date = new Date(data[field]);
      if (Number.isNaN(date.getTime())) {
        throw createError(`${field} must be a valid date`, STATUS.BAD_REQUEST, 'INVALID_COUPON_DATE');
      }
      data[field] = date;
    } else if (data[field] === '') {
      data[field] = null;
    }
  }

  if (data.startDate && data.expiryDate && data.expiryDate < data.startDate) {
    throw createError('expiryDate must be on or after startDate', STATUS.BAD_REQUEST, 'INVALID_COUPON_DATE_RANGE');
  }

  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') {
    throw createError('isActive must be true or false', STATUS.BAD_REQUEST, 'INVALID_ACTIVE_STATUS');
  }
};

const publicCoupon = (coupon) => ({
  id: coupon._id.toString(),
  couponCode: coupon.couponCode,
  description: coupon.description,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  maximumDiscount: coupon.maximumDiscount,
  minimumPurchase: coupon.minimumPurchase,
  startDate: coupon.startDate,
  expiryDate: coupon.expiryDate,
  redemptions: coupon.usedCount,
  redemptionLimit: coupon.redemptionLimit,
  usageLimitPerUser: coupon.usageLimitPerUser,
  isActive: coupon.isActive,
  createdAt: coupon.createdAt,
  updatedAt: coupon.updatedAt,
});

const getCoupons = async ({ search, status, page = 1, limit = 10, sort = 'newest' } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const filter = { deletedAt: null };

  if (status === 'active') filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;
  else if (status && status !== 'all') {
    throw createError('status must be active, inactive, or all', STATUS.BAD_REQUEST, 'INVALID_STATUS_FILTER');
  }

  const searchText = String(search || '').trim();
  if (searchText) {
    const escaped = escapeRegex(searchText);
    filter.$or = [
      { couponCode: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
    ];
  }

  const sortMap = {
    newest: { createdAt: -1, _id: -1 },
    oldest: { createdAt: 1, _id: 1 },
    code_asc: { couponCode: 1, _id: 1 },
    code_desc: { couponCode: -1, _id: -1 },
    expiry_asc: { expiryDate: 1, _id: 1 },
  };
  const sortOption = sortMap[sort] || sortMap.newest;
  const [totalResults, coupons] = await Promise.all([
    Coupon.countDocuments(filter),
    Coupon.find(filter)
      .sort(sortOption)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
  ]);

  return {
    success: true,
    data: {
      coupons: coupons.map(publicCoupon),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalResults,
        totalPages: Math.ceil(totalResults / limitNum) || 1,
      },
    },
  };
};

const createCoupon = async (payload = {}) => {
  const data = {};
  for (const field of ALLOWED_FIELDS) {
    if (payload[field] !== undefined) data[field] = payload[field];
  }
  validateCouponInput(data, { creating: true });

  const existing = await Coupon.findOne({ couponCode: data.couponCode, deletedAt : null });
  if (existing) {
    throw createError('A coupon with this code already exists', STATUS.CONFLICT, 'COUPON_CODE_EXISTS');
  }

  try {
    const coupon = await Coupon.create(data);
    return { success: true, data: publicCoupon(coupon) };
  } catch (error) {
    if (error.code === 11000) {
      throw createError('A coupon with this code already exists', STATUS.CONFLICT, 'COUPON_CODE_EXISTS');
    }
    if (error.name === 'ValidationError') {
      throw createError(error.message, STATUS.BAD_REQUEST, 'INVALID_COUPON_DATA');
    }
    throw error;
  }
};

const getCouponById = async (couponId) => {
  if (!mongoose.isValidObjectId(couponId)) {
    throw createError('Invalid coupon id', STATUS.BAD_REQUEST, 'INVALID_COUPON_ID');
  }
  const coupon = await Coupon.findOne({ _id: couponId, deletedAt: null });
  if (!coupon) throw createError('No coupon exists with this id', STATUS.NOT_FOUND, 'COUPON_NOT_FOUND');
  return { success: true, data: publicCoupon(coupon) };
};

const updateCoupon = async (couponId, payload = {}) => {
  if (!mongoose.isValidObjectId(couponId)) {
    throw createError('Invalid coupon id', STATUS.BAD_REQUEST, 'INVALID_COUPON_ID');
  }
  const coupon = await Coupon.findOne({ _id: couponId, deletedAt: null });
  if (!coupon) throw createError('No coupon exists with this id', STATUS.NOT_FOUND, 'COUPON_NOT_FOUND');

  const data = {};
  for (const field of ALLOWED_FIELDS) {
    if (payload[field] !== undefined) data[field] = payload[field];
  }
  if (Object.keys(data).length === 0) {
    throw createError('Provide at least one supported field to update', STATUS.BAD_REQUEST, 'EMPTY_COUPON_UPDATE');
  }
  validateCouponInput(data);

  if (data.couponCode && data.couponCode !== coupon.couponCode) {
    const duplicate = await Coupon.findOne({ couponCode: data.couponCode, _id: { $ne: coupon._id } });
    if (duplicate) throw createError('A coupon with this code already exists', STATUS.CONFLICT, 'COUPON_CODE_EXISTS');
  }

  // Validate the resulting combination of old and new values, not just the partial payload.
  const merged = { ...coupon.toObject(), ...data };
  if (merged.discountType === 'percentage' && merged.discountValue > 100) {
    throw createError('Percentage discount cannot exceed 100', STATUS.BAD_REQUEST, 'INVALID_DISCOUNT_VALUE');
  }
  if (merged.discountType === 'flat' && merged.maximumDiscount != null) {
    throw createError('maximumDiscount can only be used with percentage coupons', STATUS.BAD_REQUEST, 'INVALID_MAXIMUM_DISCOUNT');
  }
  if (merged.startDate && merged.expiryDate && new Date(merged.expiryDate) < new Date(merged.startDate)) {
    throw createError('expiryDate must be on or after startDate', STATUS.BAD_REQUEST, 'INVALID_COUPON_DATE_RANGE');
  }

  Object.assign(coupon, data);
  try {
    await coupon.save();
  } catch (error) {
    if (error.code === 11000) throw createError('A coupon with this code already exists', STATUS.CONFLICT, 'COUPON_CODE_EXISTS');
    if (error.name === 'ValidationError') throw createError(error.message, STATUS.BAD_REQUEST, 'INVALID_COUPON_DATA');
    throw error;
  }
  return { success: true, data: publicCoupon(coupon) };
};

const setCouponStatus = async (couponId) => {
  if (!mongoose.isValidObjectId(couponId)) {
    throw createError(
      'Invalid coupon id',
      STATUS.BAD_REQUEST,
      'INVALID_COUPON_ID'
    );
  }

  const coupon = await Coupon.findOne({
    _id: couponId,
    deletedAt: null,
  });

  if (!coupon) {
    throw createError(
      'No coupon exists with this id',
      STATUS.NOT_FOUND,
      'COUPON_NOT_FOUND'
    );
  }

  coupon.isActive = !coupon.isActive;

  await coupon.save();

  return {
    success: true,
    data: {
      id: coupon._id.toString(),
      couponCode: coupon.couponCode,
      isActive: coupon.isActive,
    },
  };
};

const deleteCoupon = async (couponId) => {
  if (!mongoose.isValidObjectId(couponId)) throw createError('Invalid coupon id', STATUS.BAD_REQUEST, 'INVALID_COUPON_ID');
  const coupon = await Coupon.findOneAndUpdate(
    { _id: couponId, deletedAt: null },
    { $set: { isActive: false, deletedAt: new Date() } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!coupon) throw createError('No coupon exists with this id', STATUS.NOT_FOUND, 'COUPON_NOT_FOUND');
  return { success: true, data: { message: 'Coupon deleted', id: coupon._id.toString() } };
};

module.exports = { getCoupons, createCoupon, getCouponById, updateCoupon, setCouponStatus, deleteCoupon };
