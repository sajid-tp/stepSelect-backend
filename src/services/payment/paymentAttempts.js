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

  if (!claimed) return Order.findById(orderId);

  if ((claimed.payment?.attempts || 0) >= maxAttempts()) {
    await releaseUnpaidOrder(claimed, RELEASE_REASON.EXHAUSTED);
    return Order.findById(orderId);
  }
  return claimed;
};

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
