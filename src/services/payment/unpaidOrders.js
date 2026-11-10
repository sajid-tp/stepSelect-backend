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
