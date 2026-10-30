// src/services/payment/paymentService.js
// Online payment flow (Razorpay real test mode / built-in demo mode, and the customer wallet):
//
//   1. initiate   -> creates the order (stock is held, cart is kept) + the gateway payment
//   2. customer pays on the Razorpay popup
//   3. verify -> checks the payment is real, marks the order PAID, empties the cart
//      (or: failed -> the order stays unpaid, the customer can retry or give up)
//   4. give up / timeout -> unpaidOrders.js returns the stock and the coupon
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
const { releaseUnpaidOrder, releaseUserUnpaidOrders, holdMinutes } = require('./unpaidOrders');
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

const isUnpaid = (order) =>
  order.paymentMethod !== PAYMENT_METHODS.COD &&
  [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED].includes(order.paymentStatus);

const toStatusView = (order) => ({
  orderId: String(order._id),
  orderNumber: order.orderNumber,
  orderStatus: order.status,
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  totalAmount: order.totalAmount,
  couponCode: order.couponCode || null,
  couponDiscount: order.couponDiscount || 0,
  referralDiscount: order.referralDiscount || 0,
  paymentId: order.payment?.paymentId || null,
  paidAt: order.payment?.paidAt || null,
  failureReason: order.payment?.failureReason || null,
  // Retry only makes sense while the order still holds its stock
  canRetry: order.status === ORDER_STATUS.PENDING && isUnpaid(order),
  holdMinutes: holdMinutes(),
});

// ---------------------------------------------------------------
// Gateway payment for an order that already exists
// ---------------------------------------------------------------
const startGatewayPayment = async (order, gateway) => {
  if (!(order.totalAmount >= 1)) {
    throw createError('This order total is too small for online payment.', STATUS.BAD_REQUEST);
  }

  const session = await gateway.createPayment({ order });

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentMethod: gateway.name,
        paymentStatus: PAYMENT_STATUS.PENDING,
        'payment.gateway': gateway.name,
        'payment.gatewayOrderId': session.gatewayOrderId,
        'payment.currency': session.currency,
        'payment.chargedAmount': session.chargedAmount,
        'payment.failureReason': null,
      },
      $inc: { 'payment.attempts': 1 },
    }
  );

  return {
    orderNumber: order.orderNumber,
    orderId: String(order._id),
    gateway: gateway.name,
    totalAmount: order.totalAmount,
    ...session.clientData,
  };
};

// ---------------------------------------------------------------
// 1. Start paying for the cart
// ---------------------------------------------------------------
const initiate = async (userId, { addressId, gateway: gatewayName } = {}) => {
  const gateway = requireGateway(gatewayName);

  // placeOrder checks address / cart / stock / coupon, takes the stock and creates the order,
  // but (for online methods) leaves the cart alone until the money has arrived.
  const placed = await checkoutService.placeOrder(
    userId,
    { addressId, paymentMethod: gateway.name },
    { allowOnline: true }
  );

  const order = await Order.findById(placed.orderId);

  try {
    return await startGatewayPayment(order, gateway);
  } catch (err) {
    // The gateway did not start: do not keep the shoes held for nothing
    await releaseUnpaidOrder(order, 'Payment could not be started');
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

  // Already paid (page refresh, webhook arrived first): fine, nothing to do
  if (current.paymentStatus === PAYMENT_STATUS.PAID || current.paymentStatus === PAYMENT_STATUS.REFUNDED) {
    return current;
  }

  // The money arrived after the order had already been released: give it back
  await Order.updateOne(
    { _id: current._id },
    { $set: { paymentStatus: PAYMENT_STATUS.PAID, 'payment.paymentId': paymentId, 'payment.paidInr': current.totalAmount, 'payment.paidAt': new Date() } }
  );
  await refundOrder(await Order.findById(current._id), null, { note: 'payment arrived after the order expired' });
  throw createError(
    'Your payment arrived after the order expired, so it was added to your wallet. Please place the order again.',
    STATUS.CONFLICT
  );
};

const markFailed = async (order, reason) => {
  await Order.updateOne(
    { _id: order._id, status: ORDER_STATUS.PENDING, paymentStatus: PAYMENT_STATUS.PENDING },
    { $set: { paymentStatus: PAYMENT_STATUS.FAILED, 'payment.failureReason': String(reason || 'Payment failed').slice(0, 200) } }
  );
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
    await markFailed(order, 'Payment verification failed');
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
    await releaseUnpaidOrder(order, 'Wallet payment failed');
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

// The popup reported a failure, or the customer closed it
const reportFailure = async (userId, orderNumber, reason) => {
  const order = await findMyOrder(userId, orderNumber);
  await markFailed(order, reason || 'Payment was not completed');
  return toStatusView(await Order.findById(order._id));
};

// Try again on the SAME order (the shoes are still held). The customer may switch gateway.
const retry = async (userId, orderNumber, { gateway: gatewayName } = {}) => {
  const order = await findMyOrder(userId, orderNumber);

  if (order.status !== ORDER_STATUS.PENDING || !isUnpaid(order)) {
    throw createError(
      order.paymentStatus === PAYMENT_STATUS.PAID
        ? 'This order is already paid.'
        : 'This payment attempt has expired. Please go back to checkout and start again.',
      STATUS.CONFLICT
    );
  }

  const gateway = requireGateway(gatewayName || order.payment?.gateway || order.paymentMethod);
  return startGatewayPayment(order, gateway);
};

// "Cancel payment": give the stock back and let the customer start over from the cart
const abandon = async (userId, orderNumber) => {
  const order = await findMyOrder(userId, orderNumber);
  const released = await releaseUnpaidOrder(order, 'Payment cancelled by customer');
  return { released };
};

const getStatus = async (userId, orderNumber) => toStatusView(await findMyOrder(userId, orderNumber));

// Razorpay webhook: covers customers who pay and then close the browser.
const handleRazorpayWebhook = async (rawBody, signature, event) => {
  const gateway = getGateway('RAZORPAY');
  if (!gateway.verifyWebhookSignature(rawBody, signature)) {
    throw createError('Invalid webhook signature.', STATUS.UNAUTHORIZED);
  }

  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id) return { handled: false };

  const order = await Order.findOne({ 'payment.gatewayOrderId': payment.order_id });
  if (!order) return { handled: false };

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    await markPaid(order, payment.id).catch((err) => console.error('Webhook markPaid:', err.message));
  } else if (event.event === 'payment.failed') {
    await markFailed(order, payment.error_description || 'Payment failed');
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
