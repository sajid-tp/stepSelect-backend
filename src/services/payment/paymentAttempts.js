// src/services/payment/paymentAttempts.js
// Counting the payment attempts of ONE order. Every change is a single atomic database update that
// only matches while it is still allowed, so the browser, the webhook, the worker and a double click
// can all report the same thing at the same time and the count is still right.
//
//   startAttempt   -> a payment window is about to open (attempt 1..4). Refused when no attempt is left.
//   recordFailure  -> the open attempt failed. The 4th failure closes the order as "Payment failed".
//   settleStale    -> an attempt nobody finished (tab closed) is counted as failed after a few minutes.
const Order = require('../../models/order');
const { ORDER_STATUS, PAYMENT_STATUS, unpaidOnlineFilter } = require('../../constants/orderConstants');
const { releaseUnpaidOrder } = require('./unpaidOrders');
const {
  maxAttempts,
  RELEASE_REASON,
  isUnpaidOnline,
  isAttemptInProgress,
  attemptDeadline,
} = require('./paymentRules');

const cleanReason = (reason) => String(reason || 'Payment failed').slice(0, 200);

// Opens attempt number (attempts + 1). Returns the updated order, or null when it is not allowed
// (order closed, all attempts used, or another attempt is still running).
const startAttempt = async (orderId, patch = {}) =>
  Order.findOneAndUpdate(
    {
      _id: orderId,
      status: ORDER_STATUS.PENDING,
      ...unpaidOnlineFilter(),
      'payment.attempts': { $lt: maxAttempts() },
      'payment.attemptOpen': { $ne: true },
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PENDING,
        'payment.attemptOpen': true,
        'payment.lastAttemptAt': new Date(),
        'payment.failureReason': null,
        ...patch,
      },
      $inc: { 'payment.attempts': 1 },
    },
    { new: true }
  );

// The open attempt failed. Safe to call twice for the same failure (browser + webhook): the second call
// finds no open attempt, or the payment id is already known, and changes nothing.
const recordFailure = async (orderId, reason, paymentId = null, { failedAt = new Date() } = {}) => {
  const pid = paymentId ? String(paymentId) : null;

  if (pid && (await Order.exists({ _id: orderId, 'payment.failedPaymentIds': pid }))) {
    return Order.findById(orderId);
  }

  const text = cleanReason(reason);
  const update = {
    $set: {
      paymentStatus: PAYMENT_STATUS.FAILED,
      'payment.attemptOpen': false,
      'payment.lastFailedAt': failedAt,
      'payment.failureReason': text,
    },
    $push: { 'payment.attemptHistory': { reason: text, paymentId: pid, failedAt } },
  };
  if (pid) update.$addToSet = { 'payment.failedPaymentIds': pid };

  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: ORDER_STATUS.PENDING,
      ...unpaidOnlineFilter(),
      'payment.attemptOpen': true,
    },
    update,
    { new: true }
  );

  if (!claimed) return Order.findById(orderId); // already counted, paid, or closed

  // The last attempt failed: nothing left to try, close the order as "Payment failed" and restock
  if ((claimed.payment?.attempts || 0) >= maxAttempts()) {
    await releaseUnpaidOrder(claimed, RELEASE_REASON.EXHAUSTED);
    return Order.findById(orderId);
  }
  return claimed;
};

// An attempt that was started but never finished (the customer closed the tab) counts as failed once its
// window is over. The failure time is the end of that window, so the cool-down is fair.
const settleStaleAttempt = async (order) => {
  if (
    !order ||
    order.status !== ORDER_STATUS.PENDING ||
    !isUnpaidOnline(order) ||
    !order.payment?.attemptOpen ||
    isAttemptInProgress(order)
  ) {
    return order;
  }
  const deadline = attemptDeadline(order) || new Date();
  return recordFailure(order._id, 'The payment was not completed', null, { failedAt: deadline });
};

// Worker job: settle every stale attempt
const sweepStaleAttempts = async () => {
  const orders = await Order.find({
    status: ORDER_STATUS.PENDING,
    ...unpaidOnlineFilter(),
    'payment.attemptOpen': true,
  }).limit(100);

  for (const order of orders) {
    try {
      await settleStaleAttempt(order);
    } catch (err) {
      console.error('Could not settle payment attempt', order.orderNumber, err.message);
    }
  }
};

module.exports = { startAttempt, recordFailure, settleStaleAttempt, sweepStaleAttempts };
