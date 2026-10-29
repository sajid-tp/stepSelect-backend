// src/services/payment/unpaidOrders.js
// An online order is created BEFORE the customer pays (so the shoes are held for them).
// If the payment never completes, this file gives the stock and the coupon back.
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');
const { restoreStock } = require('../../utils/orderHelpers');
const { releaseCoupon } = require('../user/couponService');

// How long an unpaid online order may hold stock
const holdMinutes = () => Number(process.env.PAYMENT_HOLD_MINUTES) || 30;

// Cancel ONE unpaid online order and put everything back.
// The update only matches while the order is still unpaid, so two calls at the same time
// (or a payment that just succeeded) can never release it twice.
const releaseUnpaidOrder = async (order, reason = 'Payment not completed') => {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: ORDER_STATUS.PENDING, ...unpaidOnlineFilter() },
    { $set: { status: ORDER_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: reason } },
    { new: true }
  );
  if (!claimed) return false;

  const items = await OrderItem.find({ orderId: claimed._id });
  for (const item of items) {
    if (item.status === ITEM_STATUS.CANCELLED) continue;

    const remaining = item.quantity - (item.cancelledQuantity || 0);
    await OrderItem.updateOne(
      { _id: item._id },
      {
        $set: {
          status: ITEM_STATUS.CANCELLED,
          cancelledQuantity: item.quantity,
          cancelReason: reason,
          cancelledAt: new Date(),
        },
        $push: { statusHistory: { status: ITEM_STATUS.CANCELLED, note: reason, updatedAt: new Date() } },
      }
    );
    await restoreStock(item.variantId, item.size, remaining);
  }

  await releaseCoupon(claimed.couponId);
  return true;
};

// Every unpaid online order of one customer (called when they start a new checkout)
const releaseUserUnpaidOrders = async (userId, reason = 'Payment not completed') => {
  const orders = await Order.find({ userId, status: ORDER_STATUS.PENDING, ...unpaidOnlineFilter() });
  let released = 0;
  for (const order of orders) {
    if (await releaseUnpaidOrder(order, reason)) released += 1;
  }
  return released;
};

// Unpaid online orders nobody came back to
const sweepExpiredOrders = async () => {
  const cutoff = new Date(Date.now() - holdMinutes() * 60 * 1000);
  const orders = await Order.find({
    status: ORDER_STATUS.PENDING,
    ...unpaidOnlineFilter(),
    updatedAt: { $lt: cutoff },
  }).limit(100);

  for (const order of orders) {
    try {
      await releaseUnpaidOrder(order, 'Payment timed out');
    } catch (err) {
      console.error('Could not release unpaid order', order.orderNumber, err.message);
    }
  }
};

let timer = null;
const startSweeper = () => {
  if (timer) return;
  timer = setInterval(() => {
    sweepExpiredOrders().catch((err) => console.error('Unpaid order sweep failed:', err.message));
  }, 5 * 60 * 1000);
  timer.unref();
};

module.exports = {
  holdMinutes,
  releaseUnpaidOrder,
  releaseUserUnpaidOrders,
  sweepExpiredOrders,
  startSweeper,
};
