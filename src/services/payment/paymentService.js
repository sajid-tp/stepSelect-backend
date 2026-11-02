// src/services/payment/paymentService.js
// Online payment flow (Razorpay test mode / built-in demo mode, and the customer wallet).
// The rules (see paymentRules.js):
//
//   1. initiate  -> creates the order (stock is held, cart is kept) + the gateway payment = attempt 1
//   2. The order holds its stock for 30 minutes from the moment it was created. Retries never extend it.
//   3. The customer gets 4 attempts: 1, 2 and 3 straight after each other, and a FINAL 4th attempt that
//      only opens after a 2 minute cool-down (counted from the failure of attempt 3).
//   4. verify    -> checks the payment is real, marks the order PAID, empties the cart
//      retry     -> same order, same Razorpay order id (every attempt is one more payment id under it)
//   5. 4th attempt failed, or the 30 minutes are over -> the order is closed as "Payment failed":
//      it stays in Order History, the stock and the coupon are given back (unpaidOrders.js).
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Cart = require('../../models/cart');
const Wishlist = require('../../models/wishlist');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const ERROR_CODES = require('../../constants/errorCodes');
const {
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  unpaidOnlineFilter,
} = require('../../constants/orderConstants');
const checkoutService = require('../user/checkoutService');
const { getGateway, getEnabledMethods } = require('./gateways');
const { releaseUnpaidOrder, releaseUserUnpaidOrders } = require('./unpaidOrders');
const { startAttempt, recordFailure, settleStaleAttempt } = require('./paymentAttempts');
const {
  holdMinutes,
  RELEASE_REASON,
  isUnpaidOnline,
  describeRetryState,
  getDisplayStatus,
} = require('./paymentRules');
const { refundOrder } = require('./refundService');
const walletService = require('../user/walletService');
const { WALLET_SOURCE } = require('../../constants/walletConstants');

const requireGateway = (name) => {
  const gateway = getGateway(name);
  if (!gateway) throw createError('Choose a valid payment method.', STATUS.BAD_REQUEST);
  if (!gateway.isConfigured()) {
    throw createError('Razorpay is not available right now.', STATUS.SERVICE_UNAVAILABLE);
  }
  return gateway;
};

const findMyOrder = async (userId, orderNumber) => {
  const order = await Order.findOne({ orderNumber: String(orderNumber || ''), userId });
  if (!order) throw createError('Order not found.', STATUS.NOT_FOUND, ERROR_CODES.ORDER_NOT_FOUND);
  return order;
};

const isUnpaid = isUnpaidOnline;

const clock = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

// What the payment screens (failure modal, Order Details) need to know about an order
const toStatusView = (order) => ({
  orderId: String(order._id),
  orderNumber: order.orderNumber,
  orderStatus: order.status,
  displayStatus: getDisplayStatus(order),
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  totalAmount: order.totalAmount,
  couponCode: order.couponCode || null,
  couponDiscount: order.couponDiscount || 0,
  referralDiscount: order.referralDiscount || 0,
  paymentId: order.payment?.paymentId || null,
  paidAt: order.payment?.paidAt || null,
  failureReason: order.payment?.failureReason || null,
  ...describeRetryState(order),
});

// Give the stock back right now when the order is out of time or out of attempts but the worker has not run yet
const releaseIfClosed = async (order) => {
  if (order.status !== ORDER_STATUS.PENDING || !isUnpaid(order)) return order;

  const { closedReason } = describeRetryState(order);
  if (closedReason === 'expired') await releaseUnpaidOrder(order, RELEASE_REASON.TIMED_OUT);
  else if (closedReason === 'exhausted') await releaseUnpaidOrder(order, RELEASE_REASON.EXHAUSTED);
  else return order;

  return Order.findById(order._id);
};

// Nothing is left to settle: close a stale attempt, then release what ran out
const refreshOrder = async (order) => releaseIfClosed(await settleStaleAttempt(order));

// ---------------------------------------------------------------
// Gateway payment for an order that already exists
// ---------------------------------------------------------------
// Opens one more payment attempt on the order. reuse = true (a retry): keep the Razorpay order id this
// order already has, as long as it is still the same gateway and the same amount. Otherwise a new
// Razorpay order is created. Claiming the attempt is one atomic update, so a double click can never
// open two attempts or go past the limit.
const startGatewayPayment = async (order, gateway, { reuse = false } = {}) => {
  if (!(order.totalAmount >= 1)) {
    throw createError('This order total is too small for online payment.', STATUS.BAD_REQUEST);
  }

  const sameOrderAgain =
    reuse &&
    typeof gateway.describeOrder === 'function' &&
    order.payment?.gateway === gateway.name &&
    Math.abs((order.payment?.chargedAmount || 0) - order.totalAmount) < 0.005;

  const session =
    (sameOrderAgain &&
      gateway.describeOrder({ gatewayOrderId: order.payment.gatewayOrderId, amountInr: order.totalAmount })) ||
    (await gateway.createPayment({ order }));

  const started = await startAttempt(order._id, {
    paymentMethod: gateway.name,
    'payment.gateway': gateway.name,
    'payment.gatewayOrderId': session.gatewayOrderId,
    'payment.currency': session.currency,
    'payment.chargedAmount': session.chargedAmount,
  });
  if (!started) {
    throw createError(
      'This payment cannot be started right now: another attempt is still running, or all attempts were used.',
      STATUS.CONFLICT
    );
  }

  return {
    orderNumber: order.orderNumber,
    orderId: String(order._id),
    gateway: gateway.name,
    totalAmount: order.totalAmount,
    attemptNumber: started.payment.attempts,
    maxAttempts: describeRetryState(started).maxAttempts,
    isFinalAttempt: describeRetryState(started).attemptsLeft === 0,
    holdExpiresAt: describeRetryState(started).holdExpiresAt,
    ...session.clientData,
  };
};

// A customer with an unfinished payment (a failed attempt, tries left, still inside the 30 minutes) must
// continue THAT order: starting a brand new checkout would give them a fresh set of 4 attempts every time.
const assertNoUnfinishedPayment = async (userId) => {
  const candidates = await Order.find({
    userId,
    status: ORDER_STATUS.PENDING,
    ...unpaidOnlineFilter(),
    'payment.attemptHistory.0': { $exists: true },
  });

  for (const candidate of candidates) {
    const order = await refreshOrder(candidate);
    const state = describeRetryState(order);
    if (order.status === ORDER_STATUS.PENDING && state.closedReason === null) {
      throw createError(
        `You have an unfinished payment for order ${order.orderNumber} (${state.attemptsLeft} ${
          state.attemptsLeft === 1 ? 'attempt' : 'attempts'
        } left). Open it from your order history to retry, or cancel that payment first.`,
        STATUS.CONFLICT
      );
    }
  }
};

// ---------------------------------------------------------------
// 1. Start paying for the cart
// ---------------------------------------------------------------
const initiate = async (userId, { addressId, gateway: gatewayName } = {}) => {
  const gateway = requireGateway(gatewayName);
  await assertNoUnfinishedPayment(userId);

  // placeOrder checks address / cart / stock / coupon, takes the stock and creates the order,
  // but (for online methods) leaves the cart alone until the money has arrived.
  const placed = await checkoutService.placeOrder(
    userId,
    { addressId, paymentMethod: gateway.name },
    { allowOnline: true }
  );

  const order = await Order.findById(placed.orderId);

  try {
    return await startGatewayPayment(order, gateway); // attempt 1
  } catch (err) {
    // The gateway did not start: do not keep the shoes held for nothing
    await releaseUnpaidOrder(order, RELEASE_REASON.ABANDONED);
    throw err;
  }
};

// ---------------------------------------------------------------
// 2. Paid: mark the order PAID and clean up
// ---------------------------------------------------------------
const finalizePaidOrder = async (order) => {
  const items = await OrderItem.find({ orderId: order._id });

  try {
    await OrderItem.updateMany(
      { orderId: order._id },
      { $push: { statusHistory: { status: 'pending', note: `Payment received (${order.payment.gateway})`, updatedAt: new Date() } } }
    );
    await Cart.updateOne({ userId: order.userId }, { $set: { items: [], couponId: null } });
    if (items.length > 0) {
      await Wishlist.updateOne(
        { userId: order.userId },
        { $pull: { items: { $or: items.map((i) => ({ variantId: i.variantId, size: i.size })) } } }
      );
    }
  } catch (err) {
    // The money is in and the order is paid: a cleanup problem must not fail the payment
    console.error('Cart/wishlist cleanup failed after payment', order.orderNumber, err.message);
  }
};

const markPaid = async (order, paymentId) => {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: ORDER_STATUS.PENDING, ...unpaidOnlineFilter() },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        'payment.paymentId': paymentId,
        'payment.paidAt': new Date(),
        'payment.paidInr': order.totalAmount,
        'payment.attemptOpen': false,
        'payment.failureReason': null,
      },
    },
    { new: true }
  );

  if (claimed) {
    await finalizePaidOrder(claimed);
    return claimed;
  }

  const current = await Order.findById(order._id);

  // The same payment reported again (page refresh, webhook after the browser): nothing to do
  if (current.payment?.paymentId === paymentId) return current;

  // Already paid with ANOTHER payment (two attempts both went through): the extra money goes to the wallet
  if (current.paymentStatus === PAYMENT_STATUS.PAID || current.paymentStatus === PAYMENT_STATUS.REFUNDED) {
    await refundDuplicatePayment(current, paymentId);
    return current;
  }

  // The money arrived after the order had already been closed ("Payment failed" / expired): give it back
  await Order.updateOne(
    { _id: current._id },
    { $set: { paymentStatus: PAYMENT_STATUS.PAID, 'payment.paymentId': paymentId, 'payment.paidInr': current.totalAmount, 'payment.paidAt': new Date() } }
  );
  await refundOrder(await Order.findById(current._id), null, { note: 'payment arrived after the order was closed' });
  throw createError(
    'Your payment arrived after the order was closed, so the money was added to your wallet. Please place the order again.',
    STATUS.CONFLICT
  );
};

// A second successful payment for an order that is already paid: credit it to the wallet (once per payment id)
const refundDuplicatePayment = async (order, paymentId) => {
  try {
    const marked = await Order.updateOne(
      { _id: order._id, 'payment.duplicatePaymentIds': { $ne: paymentId } },
      { $addToSet: { 'payment.duplicatePaymentIds': paymentId } }
    );
    if (!marked.modifiedCount) return; // already handled

    await walletService.creditWallet(order.userId, order.totalAmount, {
      source: WALLET_SOURCE.ORDER_CANCEL_REFUND,
      description: `Refund for a duplicate payment on order ${order.orderNumber}`,
      orderId: order._id,
      orderNumber: order.orderNumber,
      idempotencyKey: `duplicate-payment:${paymentId}`,
    });
  } catch (err) {
    console.error('Duplicate payment refund failed', order.orderNumber, paymentId, err.message);
  }
};

// Razorpay popup returned a payment: check its signature, then mark paid
const verifyRazorpay = async (userId, body = {}) => {
  const { orderNumber, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  const order = await findMyOrder(userId, orderNumber);
  const gateway = getGateway('RAZORPAY');

  if (order.payment?.gatewayOrderId !== razorpay_order_id) {
    throw createError('This payment does not belong to the order.', STATUS.BAD_REQUEST);
  }

  const valid = gateway.verifySignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!valid) {
    await recordFailure(order._id, 'Payment verification failed', razorpay_payment_id);
    throw createError('We could not verify your payment.', STATUS.BAD_REQUEST);
  }

  return toStatusView(await markPaid(order, razorpay_payment_id));
};

// ---------------------------------------------------------------
// Pay the whole order from the wallet (no popup, the result is known at once)
// ---------------------------------------------------------------
//   1. create the order (stock is held, cart is kept), exactly like an online payment
//   2. take the money from the wallet in one atomic step (fails when the balance is too low)
//   3. mark the order PAID and empty the cart
const payWithWallet = async (userId, { addressId } = {}) => {
  const placed = await checkoutService.placeOrder(
    userId,
    { addressId, paymentMethod: PAYMENT_METHODS.WALLET },
    { allowOnline: true }
  );
  const order = await Order.findById(placed.orderId);

  let debit;
  try {
    debit = await walletService.debitWallet(userId, order.totalAmount, {
      source: WALLET_SOURCE.ORDER_PAYMENT,
      description: `Payment for order ${order.orderNumber}`,
      orderId: order._id,
      orderNumber: order.orderNumber,
      idempotencyKey: `order-payment:${order._id}`,
    });
  } catch (err) {
    // Not enough money (or any other problem): give the held shoes and coupon back
    await releaseUnpaidOrder(order, RELEASE_REASON.ABANDONED);
    throw err;
  }

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'payment.gateway': PAYMENT_METHODS.WALLET,
        'payment.currency': 'INR',
        'payment.chargedAmount': order.totalAmount,
        'payment.failureReason': null,
      },
      $inc: { 'payment.attempts': 1 },
    }
  );

  try {
    const paid = await markPaid(await Order.findById(order._id), `wallet_${debit.transaction.id}`);
    return toStatusView(paid);
  } catch (err) {
    // The order could not be marked paid: give the money back instead of keeping it
    await walletService
      .creditWallet(userId, order.totalAmount, {
        source: WALLET_SOURCE.ORDER_CANCEL_REFUND,
        description: `Refund for order ${order.orderNumber} (payment could not be completed)`,
        orderId: order._id,
        orderNumber: order.orderNumber,
        idempotencyKey: `order-payment-undo:${order._id}`,
      })
      .catch((e) => console.error('Wallet payment undo failed', order.orderNumber, e.message));
    throw err;
  }
};

// The popup reported a failure, or the customer closed it. One call = the open attempt failed
// (the browser and the webhook may both report the same failure: it is counted once).
const reportFailure = async (userId, orderNumber, reason, paymentId) => {
  const order = await findMyOrder(userId, orderNumber);
  await recordFailure(order._id, reason || 'Payment was not completed', paymentId);
  return toStatusView(await refreshOrder(await Order.findById(order._id)));
};

// Try again on the SAME order (the shoes are still held). Rules: inside the 30 minutes, 4 attempts in
// total, and the final attempt only after the cool-down.
const retry = async (userId, orderNumber, { gateway: gatewayName } = {}) => {
  let order = await refreshOrder(await findMyOrder(userId, orderNumber));

  if (order.paymentStatus === PAYMENT_STATUS.PAID || order.paymentStatus === PAYMENT_STATUS.REFUNDED) {
    throw createError('This order is already paid.', STATUS.CONFLICT);
  }
  if (order.status !== ORDER_STATUS.PENDING || !isUnpaid(order)) {
    throw createError(
      'This payment is closed. The order was marked as payment failed, so please go back to your cart and place it again.',
      STATUS.CONFLICT
    );
  }

  const state = describeRetryState(order);
  if (state.attemptInProgress) {
    throw createError(
      'A payment for this order is still in progress. Finish it, or wait a few minutes before trying again.',
      STATUS.CONFLICT
    );
  }
  if (state.cooldownSecondsLeft > 0) {
    throw createError(
      `Your final attempt opens in ${clock(state.cooldownSecondsLeft)}. Please wait a moment and try again.`,
      STATUS.TOO_MANY_REQUESTS
    );
  }
  if (!state.canRetry) {
    throw createError('No payment attempts are left for this order.', STATUS.CONFLICT);
  }

  const gateway = requireGateway(gatewayName || order.payment?.gateway || order.paymentMethod);

  // Did the customer actually pay (slow UPI, closed tab)? Then there is nothing to retry.
  try {
    const paidId =
      typeof gateway.findCapturedPaymentId === 'function' && order.payment?.gatewayOrderId
        ? await gateway.findCapturedPaymentId(order.payment.gatewayOrderId)
        : null;
    if (paidId) {
      const paid = await markPaid(order, paidId);
      return { alreadyPaid: true, ...toStatusView(paid) };
    }
  } catch (err) {
    if (err.statusCode === STATUS.CONFLICT) throw err;
    console.error('Could not check Razorpay for an earlier payment:', order.orderNumber, err.message);
  }

  return startGatewayPayment(order, gateway, { reuse: true });
};

// "Cancel payment": give the stock back and let the customer start over from the cart
const abandon = async (userId, orderNumber) => {
  const order = await findMyOrder(userId, orderNumber);
  const released = await releaseUnpaidOrder(order, RELEASE_REASON.ABANDONED);
  return { released };
};

const getStatus = async (userId, orderNumber) => {
  const order = await refreshOrder(await findMyOrder(userId, orderNumber));
  return toStatusView(order);
};

// Razorpay webhook: covers customers who pay and then close the browser. Safe to receive twice.
const handleRazorpayWebhook = async (rawBody, signature, event) => {
  const gateway = getGateway('RAZORPAY');
  if (!gateway.verifyWebhookSignature(rawBody, signature)) {
    throw createError('Invalid webhook signature.', STATUS.UNAUTHORIZED);
  }

  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id) return { handled: false };

  const order = await Order.findOne({ 'payment.gatewayOrderId': payment.order_id });
  // Not a shop order: it may be a wallet top-up
  if (!order) return walletService.handleTopUpWebhook(event.event, payment);

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    await markPaid(order, payment.id).catch((err) => console.error('Webhook markPaid:', err.message));
  } else if (event.event === 'payment.failed') {
    // A failure of an EARLIER attempt that arrives late must not close the attempt running now
    const startedAt = order.payment?.lastAttemptAt ? new Date(order.payment.lastAttemptAt).getTime() : 0;
    const createdAt = payment.created_at ? Number(payment.created_at) * 1000 : Date.now();
    if (createdAt >= startedAt - 5000) {
      await recordFailure(order._id, payment.error_description || 'Payment failed', payment.id);
    }
  }
  return { handled: true };
};

module.exports = {
  initiate,
  payWithWallet,
  verifyRazorpay,
  reportFailure,
  retry,
  abandon,
  getStatus,
  handleRazorpayWebhook,
  getEnabledMethods,
  releaseUserUnpaidOrders,
};
