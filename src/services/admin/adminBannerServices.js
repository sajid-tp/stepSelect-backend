const Banner = require('../../models/banner');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const { isObjectId, escapeRegex } = require('../../utils/orderHelpers');
const uploadService = require('../user/uploadService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TITLE_MIN = 2;
const TITLE_MAX = 80;

const toView = (b) => ({
  id: String(b._id),
  title: b.title,
  image: b.image,
  link: b.link || '',
  displayOrder: b.displayOrder,
  isActive: b.isActive,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

const cleanTitle = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const validateTitle = (title) => {
  if (!title) throw createError('Banner title is required.', STATUS.BAD_REQUEST);
  if (title.length < TITLE_MIN) throw createError(`Banner title must be at least ${TITLE_MIN} characters.`, STATUS.BAD_REQUEST);
  if (title.length > TITLE_MAX) throw createError(`Banner title cannot exceed ${TITLE_MAX} characters.`, STATUS.BAD_REQUEST);
};

const cleanLink = (value) => {
  const link = String(value || '').trim();
  if (!link) return '';
  if (link.length > 300) throw createError('The link is too long.', STATUS.BAD_REQUEST);
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    if (['http:', 'https:'].includes(url.protocol)) return link;
  } catch {
  }
  throw createError('Enter a valid link, like /shop or https://example.com.', STATUS.BAD_REQUEST);
};

const cleanOrder = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw createError('Slot number must be a whole number from 1 to 99.', STATUS.BAD_REQUEST);
  }
  return n;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1';
};

const findBanner = async (bannerId) => {
  if (!isObjectId(bannerId)) throw createError('Invalid banner id.', STATUS.BAD_REQUEST);
  const banner = await Banner.findOne({ _id: bannerId, deletedAt: null });
  if (!banner) throw createError('Banner not found.', STATUS.NOT_FOUND);
  return banner;
};

// Get banners
const getBanners = async ({ search, status, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = { deletedAt: null };
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const text = search ? String(search).trim() : '';
  if (text) filter.title = new RegExp(escapeRegex(text), 'i');

  const [totalItems, banners] = await Promise.all([
    Banner.countDocuments(filter),
    Banner.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
  ]);

  return {
    banners: banners.map(toView),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

// Create banner
const createBanner = async (body = {}, file) => {
  const title = cleanTitle(body.title);
  validateTitle(title);
  const link = cleanLink(body.link);
  if (!file) throw createError('Please choose a banner image.', STATUS.BAD_REQUEST);

  const last = await Banner.findOne({ deletedAt: null }).sort({ displayOrder: -1 }).select('displayOrder');
  const displayOrder = cleanOrder(body.displayOrder, Math.min(((last && last.displayOrder) || 0) + 1, 99));

  const image = await uploadService.uploadSingle(file, 'stepSelect/banners');

  const banner = await Banner.create({
    title,
    image,
    link,
    displayOrder,
    isActive: toBool(body.isActive, true),
  });
  return toView(banner);
};

// Update banner
const updateBanner = async (bannerId, body = {}, file) => {
  const banner = await findBanner(bannerId);

  if (body.title !== undefined) {
    const title = cleanTitle(body.title);
    validateTitle(title);
    banner.title = title;
  }
  if (body.link !== undefined) banner.link = cleanLink(body.link);
  if (body.displayOrder !== undefined) banner.displayOrder = cleanOrder(body.displayOrder, banner.displayOrder);
  if (body.isActive !== undefined) banner.isActive = toBool(body.isActive, banner.isActive);
  if (file) banner.image = await uploadService.uploadSingle(file, 'stepSelect/banners');

  await banner.save();
  return toView(banner);
};

// Banner status
const toggleBannerStatus = async (bannerId, isActive) => {
  const banner = await findBanner(bannerId);
  banner.isActive = isActive === undefined ? !banner.isActive : toBool(isActive, banner.isActive);
  await banner.save();
  return toView(banner);
};

// Delete banner
const deleteBanner = async (bannerId) => {
  const banner = await findBanner(bannerId);
  banner.deletedAt = new Date();
  banner.isActive = false;
  await banner.save();
  return { id: String(banner._id) };
};

// Active banners
const getActiveBanners = async () => {
  const banners = await Banner.find({ deletedAt: null, isActive: true }).sort({ displayOrder: 1, createdAt: -1 });
  return banners.map((b) => ({ id: String(b._id), title: b.title, image: b.image, link: b.link || '', displayOrder: b.displayOrder }));
};

module.exports = { getBanners, createBanner, updateBanner, toggleBannerStatus, deleteBanner, getActiveBanners };
