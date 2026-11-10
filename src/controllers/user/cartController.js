const cartService = require('../../services/user/cartService');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const getUserId = (req) => {
  const id = req.user?.id || req.user?._id;
  if (!id) throw createError(MESSAGES.AUTH.AUTHENTICATION_REQUIRED, STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  return id;
};

const sendCart = (res, cart, message) =>
  res.status(STATUS.OK).json(message ? { message, data: cart } : { data: cart });

// Get cart
const getCart = async (req, res) => {
  const cart = await cartService.getCart(getUserId(req));
  return sendCart(res, cart);
};

// Add to cart
const addToCart = async (req, res) => {
  const { variantId, size, quantity } = req.body || {};

  const cart = await cartService.addToCart(getUserId(req), { variantId, size, quantity });
  return sendCart(res, cart, MESSAGES.CART.ITEM_ADDED_TO_CART);
};

// Update cart item
const updateCartItem = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;
  const { quantity } = req.body || {};

  const cart = await cartService.updateCartItem(getUserId(req), variantId, size, quantity);
  return sendCart(res, cart, MESSAGES.CART.CART_UPDATED);
};

// Remove cart item
const removeCartItem = async (req, res) => {
  const { variantId } = req.params;
  const { size } = req.query;

  const cart = await cartService.removeCartItem(getUserId(req), variantId, size);
  return sendCart(res, cart, MESSAGES.CART.ITEM_REMOVED_FROM_CART);
};

// Clear cart
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
