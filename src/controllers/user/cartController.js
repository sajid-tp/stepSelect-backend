const cartService = require('../../services/user/cartService');
const createError = require('../../utils/createError');

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
  if (!id) throw createError('Authentication required.', 401, 'UNAUTHORIZED');
  return id;
};

const sendCart = (res, cart, message) =>
  res.status(200).json(message ? { message, data: cart } : { data: cart });

const sendError = (res, err) => {
  const isKnown = Boolean(err.statusCode);

  // Known errors are the customer's mistakes; only log unexpected ones.
  if (!isKnown) console.error('[cart] unexpected error:', err);

  return res.status(err.statusCode || 500).json({
    error: {
      code: err.code || 'SERVER_ERROR',
      message: isKnown ? err.message : 'Something went wrong. Please try again.',
    },
  });
};

// GET /api/cart
const getCart = async (req, res) => {
  try {
    const cart = await cartService.getCart(getUserId(req));
    return sendCart(res, cart);
  } catch (err) {
    return sendError(res, err);
  }
};

// POST /api/cart   body: { variantId, size, quantity? }
const addToCart = async (req, res) => {
  try {
    const { variantId, size, quantity } = req.body || {};

    const cart = await cartService.addToCart(getUserId(req), { variantId, size, quantity });
    return sendCart(res, cart, 'Item added to cart.');
  } catch (err) {
    return sendError(res, err);
  }
};

// PATCH /api/cart/items/:variantId?size=10   body: { quantity }
const updateCartItem = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { size } = req.query;
    const { quantity } = req.body || {};

    const cart = await cartService.updateCartItem(getUserId(req), variantId, size, quantity);
    return sendCart(res, cart, 'Cart updated.');
  } catch (err) {
    return sendError(res, err);
  }
};

// DELETE /api/cart/items/:variantId?size=10
const removeCartItem = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { size } = req.query;

    const cart = await cartService.removeCartItem(getUserId(req), variantId, size);
    return sendCart(res, cart, 'Item removed from cart.');
  } catch (err) {
    return sendError(res, err);
  }
};

// DELETE /api/cart
const clearCart = async (req, res) => {
  try {
    const cart = await cartService.clearCart(getUserId(req));
    return sendCart(res, cart, 'Cart cleared.');
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
