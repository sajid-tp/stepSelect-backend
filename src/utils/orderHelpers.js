// src/utils/orderHelpers.js
// Small helpers shared by checkout, orders and admin order services.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Variant = require('../models/variants');
const OrderItem = require('../models/orderItem');
const {
  PRICING,
  ORDER_STATUS,
  ITEM_STATUS,
  RETURNABLE_ORDER_STATUSES,
  ESTIMATED_DELIVERY_DAYS,
} = require('../constants/orderConstants');

const isObjectId = (id) => Boolean(id) && /^[0-9a-fA-F]{24}$/.test(String(id));

// "ORD-20261020-A3F9C2": same format every time, random part makes it unique
const generateOrderNumber = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${date}-${random}`;
};

// Make user text safe to put inside a RegExp (search boxes)
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Price after discount for ONE unit
const getFinalUnitPrice = (price, discountPercent) => {
  const p = Number(price) || 0;
  const d = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
  return Math.round(p - (p * d) / 100);
};

// Money for one line. Used by the checkout summary and when the order is created,
// so the user always pays exactly what the summary showed.
const calculateLine = (price, discountPercent, quantity) => {
  const finalPrice = getFinalUnitPrice(price, discountPercent);
  const lineSubtotal = Number(price) * quantity;
  const itemTotal = finalPrice * quantity;
  return {
    finalPrice,
    lineSubtotal,
    itemTotal,
    lineDiscount: lineSubtotal - itemTotal,
    taxAmount: Math.round((itemTotal * PRICING.TAX_PERCENT) / 100),
  };
};

// Totals for a list of lines (each line from calculateLine)
const calculateTotals = (lines, shippingFeeOverride) => {
  const subtotal = lines.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const discountTotal = lines.reduce((sum, l) => sum + l.lineDiscount, 0);
  const taxTotal = lines.reduce((sum, l) => sum + l.taxAmount, 0);
  const afterDiscount = subtotal - discountTotal;

  let shippingFee = shippingFeeOverride;
  if (shippingFee === undefined) {
    const free = PRICING.FREE_SHIPPING_ABOVE > 0 && afterDiscount >= PRICING.FREE_SHIPPING_ABOVE;
    shippingFee = free || lines.length === 0 ? 0 : PRICING.SHIPPING_FEE;
  }

  return {
    subtotal,
    discountTotal,
    taxTotal,
    shippingFee,
    totalAmount: afterDiscount + taxTotal + shippingFee,
  };
};

// Take stock out. Atomic: the update only matches if enough stock is still there,
// so two people buying the last pair at the same time can never both succeed.
const reduceStock = async (variantId, size, quantity) => {
  const result = await Variant.updateOne(
    { _id: variantId, sizes: { $elemMatch: { size: String(size), stock: { $gte: quantity } } } },
    { $inc: { 'sizes.$.stock': -quantity } }
  );
  return result.modifiedCount === 1;
};

// Put stock back (cancel / approved return)
// Put stock back (cancellation / approved return).
// Optional session supports transaction-safe stock restoration.

const restoreStock = async (variantId, size, quantity) => {
  if (!quantity || quantity < 1) return;

  const result = await Variant.updateOne(
    {
      _id: variantId,
      'sizes.size': String(size),
    },
    {
      $inc: {
        'sizes.$.stock': quantity,
      },
    }
  );

  if (result.matchedCount !== 1) {
    throw new Error(
      `Unable to restore stock for variant ${variantId}, size ${size}`
    );
  }
};

// Add a line to the item's status history
const pushHistory = (item, status, note = '') => {
  item.statusHistory.push({ status, note, updatedAt: new Date() });
};

// "2026-10-25": the day the order is expected to arrive (stored at order time, or placed date + N days for old orders)
const estimatedDeliveryDate = (order) => {
  const base = order.estimatedDelivery
    ? new Date(order.estimatedDelivery)
    : new Date(new Date(order.createdAt || Date.now()).getTime() + ESTIMATED_DELIVERY_DAYS * 24 * 60 * 60 * 1000);
  return base.toISOString().slice(0, 10);
};

const addDays = (date, days) => new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);

// Keep the ORDER's return state in line with its items:
//   any item waiting for admin  -> return_requested
//   every live item returned    -> returned
//   otherwise                   -> delivered
// Only touches orders that are already delivered (or in a return state).
const syncReturnStatus = async (order) => {
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) return;

  const items = await OrderItem.find({ orderId: order._id });
  const live = items.filter((i) => i.status !== ITEM_STATUS.CANCELLED);

  let next = ORDER_STATUS.DELIVERED;
  if (live.some((i) => i.status === ITEM_STATUS.RETURN_REQUESTED)) {
    next = ORDER_STATUS.RETURN_REQUESTED;
  } else if (live.length > 0 && live.every((i) => i.status === ITEM_STATUS.RETURNED)) {
    next = ORDER_STATUS.RETURNED;
  }

  if (next !== order.status) {
    order.status = next;
    await order.save();
  }
};

const first = (images) => {
  if (!images || images.length === 0) return null;
  const img = images[0];
  return typeof img === 'string' ? img : img.url || null;
};

module.exports = {
  isObjectId,
  generateOrderNumber,
  escapeRegex,
  getFinalUnitPrice,
  calculateLine,
  calculateTotals,
  reduceStock,
  restoreStock,
  pushHistory,
  estimatedDeliveryDate,
  addDays,
  syncReturnStatus,
  firstImage: first,
  mongoose,
};
