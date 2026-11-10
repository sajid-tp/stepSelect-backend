const wishlistService = require('../../services/user/wishlistService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const send = (res, data, message, status = STATUS.OK) =>
  res.status(status).json(message ? { message, data } : { data });

// Get wishlist
const getWishlist = async (req, res) => {
  const { page, limit } = req.query;
  const wishlist = await wishlistService.getWishlist(getUserId(req), { page, limit });
  return send(res, wishlist);
};

// Wishlist ids
const getWishlistIds = async (req, res) => {
  const result = await wishlistService.getWishlistIds(getUserId(req));
  return send(res, result);
};

// Add to wishlist
const addToWishlist = async (req, res) => {
  const { variantId, size } = req.body || {};

  const { added, ...result } = await wishlistService.addToWishlist(getUserId(req), { variantId, size });

  return added
    ? send(res, result, MESSAGES.WISHLIST.ITEM_ADDED_TO_WISHLIST, STATUS.CREATED)
    : send(res, result, MESSAGES.WISHLIST.ALREADY_IN_WISHLIST);
};

// Remove from wishlist
const removeFromWishlist = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;

  const result = await wishlistService.removeFromWishlist(getUserId(req), variantId, size);
  return send(res, result, MESSAGES.WISHLIST.ITEM_REMOVED_FROM_WISHLIST);
};

// Clear wishlist
const clearWishlist = async (req, res) => {
  const result = await wishlistService.clearWishlist(getUserId(req));
  return send(res, result, MESSAGES.WISHLIST.WISHLIST_CLEARED);
};

module.exports = {
  getWishlist,
  getWishlistIds,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
};
