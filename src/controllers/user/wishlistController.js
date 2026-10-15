const wishlistService = require('../../services/user/wishlistService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  Response contract (every wishlist endpoint)

  success  ->  { "message": "...", "data": <result> }      (GET has no message)
  failure  ->  4xx  { "success": false, "message": "...", "error": { "code": "...", "message": "..." } }

  A wishlist item is one colour (variantId) + one size, like a cart line.

  GET    /api/wishlist?page=1&limit=12        -> data = { id, items[], pagination }
  GET    /api/wishlist/ids                    -> data = { items: [{ productId, variantId, size }] }
  POST   /api/wishlist  { variantId, size }   -> data = { variantId, size, inWishlist, totalItems }   (201 new, 200 already saved)
  DELETE /api/wishlist/items/:variantId?size= -> data = { variantId, size, inWishlist, totalItems }
  DELETE /api/wishlist                        -> data = { totalItems }

  items[] = { productId, variantId, name, brand, color, size, image, price, discountPercent,
              finalPrice, stock, inStock, isAvailable, issue, addedAt }
  issue = null | 'OUT_OF_STOCK' | 'UNAVAILABLE'
*/

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const send = (res, data, message, status = STATUS.OK) =>
  res.status(status).json(message ? { message, data } : { data });

// GET /api/wishlist
const getWishlist = async (req, res) => {
  const { page, limit } = req.query;
  const wishlist = await wishlistService.getWishlist(getUserId(req), { page, limit });
  return send(res, wishlist);
};

// GET /api/wishlist/ids
const getWishlistIds = async (req, res) => {
  const result = await wishlistService.getWishlistIds(getUserId(req));
  return send(res, result);
};

// POST /api/wishlist   body: { variantId, size }
const addToWishlist = async (req, res) => {
  const { variantId, size } = req.body || {};

  const { added, ...result } = await wishlistService.addToWishlist(getUserId(req), { variantId, size });

  return added
    ? send(res, result, MESSAGES.WISHLIST.ITEM_ADDED_TO_WISHLIST, STATUS.CREATED)
    : send(res, result, MESSAGES.WISHLIST.ALREADY_IN_WISHLIST);
};

// DELETE /api/wishlist/items/:variantId?size=10
const removeFromWishlist = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;

  const result = await wishlistService.removeFromWishlist(getUserId(req), variantId, size);
  return send(res, result, MESSAGES.WISHLIST.ITEM_REMOVED_FROM_WISHLIST);
};

// DELETE /api/wishlist
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
