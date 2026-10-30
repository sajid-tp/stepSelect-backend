// src/services/admin/adminOfferServices.js
// Admin side of the offers: product offers, category offers, and the referral programme rules.
const mongoose = require('mongoose');
const Offer = require('../../models/offer');
const Product = require('../../models/products');
const Category = require('../../models/categories');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const ERROR_CODES = require('../../constants/errorCodes');
const { OFFER_TYPE, OFFER_LIMITS } = require('../../constants/offerConstants');
const referralService = require('../user/referralService');

const ALLOWED_FIELDS = ['offerName', 'offerType', 'productId', 'categoryId', 'discountPercent', 'startDate', 'expiryDate', 'isActive'];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bad = (message, code = ERROR_CODES.INVALID_OFFER_DATA) => createError(message, STATUS.BAD_REQUEST, code);

// "2026-03-31" (from a date input) -> start / end of that day in the server's time zone.
// Anything else (an ISO date-time) is used as it is.
const parseDate = (value, { endOfDay = false } = {}) => {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  const date = match
    ? endOfDay
      ? new Date(+match[1], +match[2] - 1, +match[3], 23, 59, 59, 999)
      : new Date(+match[1], +match[2] - 1, +match[3], 0, 0, 0, 0)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw bad('Enter a valid date');
  return date;
};

// What the table shows in the Status column
const displayStatus = (offer, now = new Date()) => {
  if (offer.expiryDate && new Date(offer.expiryDate) < now) return 'expired';
  if (!offer.isActive) return 'inactive';
  if (offer.startDate && new Date(offer.startDate) > now) return 'scheduled';
  return 'active';
};

const publicOffer = (offer, names = {}) => ({
  id: String(offer._id),
  offerName: offer.offerName,
  offerType: offer.offerType,
  productId: offer.productId ? String(offer.productId) : null,
  categoryId: offer.categoryId ? String(offer.categoryId) : null,
  targetName: offer.offerType === OFFER_TYPE.PRODUCT ? names.product || '—' : names.category || '—',
  discountPercent: offer.discountPercent,
  startDate: offer.startDate,
  expiryDate: offer.expiryDate,
  isActive: offer.isActive,
  status: displayStatus(offer),
  createdAt: offer.createdAt,
  updatedAt: offer.updatedAt,
});

// Fill in the product / category names for a list of offers (2 queries, not 1 per row)
const withNames = async (offers) => {
  const [products, categories] = await Promise.all([
    Product.find({ _id: { $in: offers.map((o) => o.productId).filter(Boolean) } }).select('productName').lean(),
    Category.find({ _id: { $in: offers.map((o) => o.categoryId).filter(Boolean) } }).select('categoryName').lean(),
  ]);
  const productNames = new Map(products.map((p) => [String(p._id), p.productName]));
  const categoryNames = new Map(categories.map((c) => [String(c._id), c.categoryName]));
  return offers.map((o) =>
    publicOffer(o, {
      product: o.productId ? productNames.get(String(o.productId)) : null,
      category: o.categoryId ? categoryNames.get(String(o.categoryId)) : null,
    })
  );
};

const assertValidId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw bad('Invalid offer id', ERROR_CODES.INVALID_OFFER_ID);
};

// Checks the fields and turns them into what is saved. `current` = the saved offer when editing.
const buildOfferData = async (payload, current = null) => {
  const data = {};
  for (const field of ALLOWED_FIELDS) if (payload[field] !== undefined) data[field] = payload[field];

  const merged = { ...(current ? current.toObject() : {}), ...data };

  if (!current && !data.offerType) throw bad('Choose whether this is a product offer or a category offer');
  if (data.offerType !== undefined && !Object.values(OFFER_TYPE).includes(data.offerType)) {
    throw bad('Offer type must be product or category');
  }
  if (current && data.offerType && data.offerType !== current.offerType) {
    throw bad('The offer type cannot be changed. Create a new offer instead.');
  }

  if (data.offerName !== undefined) {
    const name = String(data.offerName || '').trim();
    if (name.length < 3 || name.length > 80) throw bad('Offer name must be 3 to 80 characters');
    data.offerName = name;
  } else if (!current) {
    throw bad('Offer name is required');
  }

  if (data.discountPercent !== undefined) {
    const percent = Number(data.discountPercent);
    if (!Number.isInteger(percent) || percent < OFFER_LIMITS.MIN_PERCENT || percent > OFFER_LIMITS.MAX_PERCENT) {
      throw bad(`Discount must be a whole number from ${OFFER_LIMITS.MIN_PERCENT} to ${OFFER_LIMITS.MAX_PERCENT}`);
    }
    data.discountPercent = percent;
  } else if (!current) {
    throw bad('Discount is required');
  }

  if (data.startDate !== undefined) data.startDate = parseDate(data.startDate) || new Date();
  if (data.expiryDate !== undefined) {
    data.expiryDate = parseDate(data.expiryDate, { endOfDay: true });
    if (!data.expiryDate) throw bad('Expiry date is required');
  } else if (!current) {
    throw bad('Expiry date is required');
  }

  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') throw bad('isActive must be true or false');

  const start = data.startDate || merged.startDate || new Date();
  const expiry = data.expiryDate || merged.expiryDate;
  if (expiry && start && expiry < start) throw bad('Expiry date must be on or after the start date');
  if (!current && expiry < new Date()) throw bad('Expiry date cannot be in the past');

  // the target the offer applies to
  const type = merged.offerType;
  if (type === OFFER_TYPE.PRODUCT && (data.productId !== undefined || !current)) {
    if (!mongoose.isValidObjectId(data.productId)) throw bad('Choose a product for this offer');
    const product = await Product.findOne({ _id: data.productId, deletedAt: null }).select('_id');
    if (!product) throw bad('That product does not exist');
    data.categoryId = null;
  }
  if (type === OFFER_TYPE.CATEGORY && (data.categoryId !== undefined || !current)) {
    if (!mongoose.isValidObjectId(data.categoryId)) throw bad('Choose a category for this offer');
    const category = await Category.findOne({ _id: data.categoryId, deletedAt: null }).select('_id');
    if (!category) throw bad('That category does not exist');
    data.productId = null;
  }

  return { data, merged: { ...merged, ...data } };
};

// Two live offers on the same product / category with overlapping dates would confuse the admin
// (the shopper still gets the larger one, but only one offer should exist per target at a time).
const assertNoOverlap = async (merged, ignoreId = null) => {
  if (merged.isActive === false) return;

  const filter = {
    deletedAt: null,
    isActive: true,
    offerType: merged.offerType,
    startDate: { $lte: merged.expiryDate },
    expiryDate: { $gte: merged.startDate || new Date() },
  };
  if (merged.offerType === OFFER_TYPE.PRODUCT) filter.productId = merged.productId;
  else filter.categoryId = merged.categoryId;
  if (ignoreId) filter._id = { $ne: ignoreId };

  const clash = await Offer.findOne(filter).select('offerName');
  if (clash) {
    throw createError(
      `"${clash.offerName}" already covers this ${merged.offerType} in these dates. Edit or switch it off first.`,
      STATUS.CONFLICT,
      ERROR_CODES.OFFER_OVERLAP
    );
  }
};

const saveOffer = async (doc) => {
  try {
    await doc.save();
  } catch (error) {
    if (error.name === 'ValidationError') throw bad(Object.values(error.errors)[0]?.message || error.message);
    throw error;
  }
};

// ---------------------------------------------------------------
// List
// ---------------------------------------------------------------
const getOffers = async ({ search, type, status = 'all', page = 1, limit = 10, sort = 'newest' } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const now = new Date();

  const filter = { deletedAt: null };
  if (type) {
    if (!Object.values(OFFER_TYPE).includes(type)) throw bad('type must be product or category');
    filter.offerType = type;
  }

  if (status === 'active') Object.assign(filter, { isActive: true, expiryDate: { $gte: now }, startDate: { $lte: now } });
  else if (status === 'inactive') Object.assign(filter, { isActive: false, expiryDate: { $gte: now } });
  else if (status === 'expired') filter.expiryDate = { $lt: now };
  else if (status === 'scheduled') Object.assign(filter, { isActive: true, startDate: { $gt: now } });
  else if (status !== 'all') throw bad('status must be all, active, inactive, expired or scheduled');

  const text = String(search || '').trim();
  if (text) {
    const regex = { $regex: escapeRegex(text), $options: 'i' };
    const [products, categories] = await Promise.all([
      Product.find({ deletedAt: null, productName: regex }).select('_id').limit(200).lean(),
      Category.find({ deletedAt: null, categoryName: regex }).select('_id').limit(200).lean(),
    ]);
    filter.$or = [
      { offerName: regex },
      { productId: { $in: products.map((p) => p._id) } },
      { categoryId: { $in: categories.map((c) => c._id) } },
    ];
  }

  const sortMap = {
    newest: { createdAt: -1, _id: -1 },
    oldest: { createdAt: 1, _id: 1 },
    discount_desc: { discountPercent: -1, _id: -1 },
    expiry_asc: { expiryDate: 1, _id: 1 },
  };

  const [totalResults, offers] = await Promise.all([
    Offer.countDocuments(filter),
    Offer.find(filter)
      .sort(sortMap[sort] || sortMap.newest)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  return {
    success: true,
    data: {
      offers: await withNames(offers),
      pagination: { page: pageNum, limit: limitNum, totalResults, totalPages: Math.ceil(totalResults / limitNum) || 1 },
    },
  };
};

// ---------------------------------------------------------------
// One / create / update / switch / delete
// ---------------------------------------------------------------
const getOfferById = async (offerId) => {
  assertValidId(offerId);
  const offer = await Offer.findOne({ _id: offerId, deletedAt: null }).lean();
  if (!offer) throw createError('No offer exists with this id', STATUS.NOT_FOUND, ERROR_CODES.OFFER_NOT_FOUND);
  const [view] = await withNames([offer]);
  return { success: true, data: view };
};

const createOffer = async (payload = {}) => {
  const { data, merged } = await buildOfferData(payload);
  await assertNoOverlap({ ...merged, isActive: data.isActive !== false });

  const offer = new Offer(data);
  await saveOffer(offer);
  const [view] = await withNames([offer.toObject()]);
  return { success: true, data: view };
};

const updateOffer = async (offerId, payload = {}) => {
  assertValidId(offerId);
  const offer = await Offer.findOne({ _id: offerId, deletedAt: null });
  if (!offer) throw createError('No offer exists with this id', STATUS.NOT_FOUND, ERROR_CODES.OFFER_NOT_FOUND);

  const { data, merged } = await buildOfferData(payload, offer);
  if (Object.keys(data).length === 0) throw bad('Provide at least one field to update');
  await assertNoOverlap(merged, offer._id);

  Object.assign(offer, data);
  await saveOffer(offer);
  const [view] = await withNames([offer.toObject()]);
  return { success: true, data: view };
};

const setOfferStatus = async (offerId) => {
  assertValidId(offerId);
  const offer = await Offer.findOne({ _id: offerId, deletedAt: null });
  if (!offer) throw createError('No offer exists with this id', STATUS.NOT_FOUND, ERROR_CODES.OFFER_NOT_FOUND);

  // switching ON must not clash with another live offer on the same target
  if (!offer.isActive) await assertNoOverlap({ ...offer.toObject(), isActive: true }, offer._id);

  offer.isActive = !offer.isActive;
  await saveOffer(offer);
  return { success: true, data: { id: String(offer._id), offerName: offer.offerName, isActive: offer.isActive, status: displayStatus(offer) } };
};

const deleteOffer = async (offerId) => {
  assertValidId(offerId);
  const offer = await Offer.findOneAndUpdate(
    { _id: offerId, deletedAt: null },
    { $set: { isActive: false, deletedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!offer) throw createError('No offer exists with this id', STATUS.NOT_FOUND, ERROR_CODES.OFFER_NOT_FOUND);
  return { success: true, data: { message: 'Offer deleted', id: String(offer._id), offerName: offer.offerName } };
};

// ---------------------------------------------------------------
// Drop-down data for the create / edit form
// ---------------------------------------------------------------
const getOfferOptions = async ({ search } = {}) => {
  const text = String(search || '').trim();
  const productFilter = { deletedAt: null, isActive: true };
  if (text) productFilter.productName = { $regex: escapeRegex(text), $options: 'i' };

  const [categories, products] = await Promise.all([
    Category.find({ deletedAt: null, isActive: true }).sort({ categoryName: 1 }).select('categoryName').lean(),
    Product.find(productFilter).sort({ productName: 1 }).limit(25).select('productName categoryId').populate('categoryId', 'categoryName').lean(),
  ]);

  return {
    success: true,
    data: {
      categories: categories.map((c) => ({ id: String(c._id), name: c.categoryName })),
      products: products.map((p) => ({ id: String(p._id), name: p.productName, categoryName: p.categoryId?.categoryName || '' })),
    },
  };
};

// ---------------------------------------------------------------
// Referral programme (the third tab of the Offers page)
// ---------------------------------------------------------------
const getReferral = async () => ({ success: true, data: await referralService.getAdminReferral() });
const updateReferral = async (payload) => ({ success: true, data: await referralService.updateReferralProgram(payload) });

module.exports = {
  getOffers,
  getOfferById,
  createOffer,
  updateOffer,
  setOfferStatus,
  deleteOffer,
  getOfferOptions,
  getReferral,
  updateReferral,
};
