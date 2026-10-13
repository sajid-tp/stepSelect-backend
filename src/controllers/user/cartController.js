const cartService = require('../../services/user/cartService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

/*
  Response contract (every cart endpoint)

  success  ->  200  { "message": "...", "data": <cart> }      (GET has no message)
  failure  ->  4xx  { "error": { "code": "...", "message": "..." } }

  <cart> = { id, items[], totalPrice, totalItems, maxQuantityPerItem }
  See docs/CART_API.md for the full shape and every error code.
*/

// Adjust this one line if your auth middleware sets the user differently.
const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const sendCart = (res, cart, message) =>
  res.status(STATUS.OK).json(message ? { message, data: cart } : { data: cart });

// GET /api/cart
const getCart = async (req, res) => {
  const cart = await cartService.getCart(getUserId(req));
  return sendCart(res, cart);
};

// POST /api/cart   body: { variantId, size, quantity? }
const addToCart = async (req, res) => {
  const { variantId, size, quantity } = req.body || {};

  const cart = await cartService.addToCart(getUserId(req), { variantId, size, quantity });
  return sendCart(res, cart, MESSAGES.CART.ITEM_ADDED_TO_CART);
};

// PATCH /api/cart/items/:variantId?size=10   body: { quantity }
const updateCartItem = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;
  const { quantity } = req.body || {};

  const cart = await cartService.updateCartItem(getUserId(req), variantId, size, quantity);
  return sendCart(res, cart, MESSAGES.CART.CART_UPDATED);
};

// DELETE /api/cart/items/:variantId?size=10
const removeCartItem = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;

  const cart = await cartService.removeCartItem(getUserId(req), variantId, size);
  return sendCart(res, cart, MESSAGES.CART.ITEM_REMOVED_FROM_CART);
};

// DELETE /api/cart
const clearCart = async (req, res) => {
  const cart = await cartService.clearCart(getUserId(req));
  return sendCart(res, cart, MESSAGES.CART.CART_CLEARED);
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
