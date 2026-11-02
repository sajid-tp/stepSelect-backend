// src/services/payment/unpaidOrders.js
// An online order is created BEFORE the customer pays (so the shoes are held for them).
// If the payment never completes, this file closes the order as "Payment failed" and gives the
// stock and the coupon back. (The rules themselves live in paymentRules.js.)
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  PAYMENT_STATUS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');
const { restoreStock } = require('../../utils/orderHelpers');
const { releaseCoupon } = require('../user/couponService');
const { runInTransaction } = require('../../utils/transaction');
const {
  holdMinutes,
  maxAttempts,
  RELEASE_REASON,
  closedReasonForRelease,
  holdExpiresAt,
  isHoldExpired,
} = require('./paymentRules');

// Close ONE unpaid online order and put everything back.
// The order stays in the customer's Order History as "Payment failed" (status cancelled + paymentStatus failed),
// but it is never shown to the admin and never counted as a sale.
// The update only matches while the order is still unpaid, so two calls at the same time
// (or a payment that just succeeded) can never release it twice.
// Everything below runs in ONE database transaction: the order is closed, the items are cancelled,
// the stock and the coupon come back, or (if something fails half way) none of it happens and the
// worker / the next call simply tries again. (Without transaction support it runs as before.)
const releaseUnpaidOrder = async (order, reason = RELEASE_REASON.ABANDONED) =>
  runInTransaction(async (session) => {
    const now = new Date();
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, status: ORDER_STATUS.PENDING, ...unpaidOnlineFilter() },
      {
        $set: {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
          cancelledAt: now,
          cancelReason: reason,
          'payment.attemptOpen': false,
          'payment.closedReason': closedReasonForRelease(reason),
          'payment.closedAt': now,
        },
      },
      { new: true, session }
    );
    if (!claimed) return false;

    const itemsQuery = OrderItem.find({ orderId: claimed._id });
    if (session) itemsQuery.session(session);
    const items = await itemsQuery;
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
            cancelledAt: now,
          },
          $push: { statusHistory: { status: ITEM_STATUS.CANCELLED, note: reason, updatedAt: now } },
        },
        { session }
      );
      await restoreStock(item.variantId, item.size, remaining, { session });
    }

    await releaseCoupon(claimed.couponId, { session });
    return true;
  });

// Unpaid online orders of one customer (called when they start a new checkout).
// keepRetryable = true leaves alone the orders that already had a failed attempt and can still be retried
// (the customer may come back to them from Order History).
const releaseUserUnpaidOrders = async (userId, reason = RELEASE_REASON.ABANDONED, { keepRetryable = false } = {}) => {
  const filter = { userId, status: ORDER_STATUS.PENDING, ...unpaidOnlineFilter() };
  if (keepRetryable) filter['payment.attemptHistory.0'] = { $exists: false };

  const orders = await Order.find(filter);
  let released = 0;
  for (const order of orders) {
    if (await releaseUnpaidOrder(order, reason)) released += 1;
  }
  return released;
};

// Unpaid online orders whose 30 minutes are over. Retries and failed payments never move this clock:
// it always counts from the moment the order was created.
const sweepExpiredOrders = async () => {
  const cutoff = new Date(Date.now() - holdMinutes() * 60 * 1000);
  const orders = await Order.find({
    status: ORDER_STATUS.PENDING,
    ...unpaidOnlineFilter(),
    createdAt: { $lt: cutoff },
  }).limit(100);

  let released = 0;
  for (const order of orders) {
    try {
      if (await releaseUnpaidOrder(order, RELEASE_REASON.TIMED_OUT)) released += 1;
    } catch (err) {
      console.error('Could not release unpaid order', order.orderNumber, err.message);
    }
  }
  return released;
};

module.exports = {
  holdMinutes,
  maxAttempts,
  RELEASE_REASON,
  holdExpiresAt,
  isHoldExpired,
  releaseUnpaidOrder,
  releaseUserUnpaidOrders,
  sweepExpiredOrders,
};
