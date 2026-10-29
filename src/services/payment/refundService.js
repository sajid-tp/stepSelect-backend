// src/services/payment/refundService.js
<<<<<<< HEAD
// Money back to the customer. Every refund goes to the customer's WALLET (never back to the card).
//
//   cancellation  -> refunded straight away (nobody has to approve it)
//   return        -> refunded when the admin approves the return
//
// What counts as "paid":
//   Razorpay / Wallet orders  -> the amount that was really paid (payment.paidInr)
//   Cash on Delivery orders   -> only after delivery (paymentStatus becomes "paid"), so a return
//                                gives the cash value back as wallet money. A COD order that is
//                                cancelled before delivery has nothing to refund.
const Order = require('../../models/order');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../../constants/orderConstants');
const { WALLET_SOURCE } = require('../../constants/walletConstants');
const { creditWallet } = require('../user/walletService');
=======
// Money back for an online-paid order when it is cancelled or a return is approved.
// Cash on Delivery orders (and unpaid ones) are ignored, so callers can call this blindly.
const Order = require('../../models/order');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../../constants/orderConstants');
const { getGateway } = require('./gateways');
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// amountInr = null  ->  refund everything that is still left
<<<<<<< HEAD
// options.reason    -> 'cancel' (default) or 'return'
// options.note      -> shown in the wallet history, e.g. the product name
// Never throws: a wallet problem must not undo a cancellation / return that already happened.
// The failure is stored on the order (payment.refundError) so the admin can see it.
const refundOrder = async (order, amountInr = null, { reason = 'cancel', note = '' } = {}) => {
  try {
    if (!order) return null;
=======
// Never throws: a gateway problem must not undo a cancellation that already happened.
// The failure is stored on the order (payment.refundError) so the admin can see it.
const refundOrder = async (order, amountInr = null) => {
  try {
    if (!order || order.paymentMethod === PAYMENT_METHODS.COD) return null;
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0

    // Read fresh numbers: the order object in the caller can be a little old
    const fresh = await Order.findById(order._id);
    if (!fresh || fresh.paymentStatus !== PAYMENT_STATUS.PAID) return null;

<<<<<<< HEAD
    const isCod = fresh.paymentMethod === PAYMENT_METHODS.COD;
    const paid = fresh.payment?.paidInr || (isCod ? fresh.totalAmount : 0);
    const refundedBefore = round2(fresh.payment?.refundedInr || 0);
    const left = round2(paid - refundedBefore);
    const amount = amountInr === null ? left : Math.min(round2(amountInr), left);
    if (amount <= 0) return null;

    const isReturn = reason === 'return';
    const description = isReturn
      ? `Refund for returned item${note ? ` (${note})` : ''}, order ${fresh.orderNumber}`
      : `Refund for cancelled order ${fresh.orderNumber}${note ? ` (${note})` : ''}`;

    // The key is built from what was already refunded, so the same refund can never be added twice
    const result = await creditWallet(fresh.userId, amount, {
      source: isReturn ? WALLET_SOURCE.ORDER_RETURN_REFUND : WALLET_SOURCE.ORDER_CANCEL_REFUND,
      description,
      orderId: fresh._id,
      orderNumber: fresh.orderNumber,
      idempotencyKey: `refund:${fresh._id}:${reason}:${refundedBefore}:${amount}`,
    });
    if (result.duplicate) return null;

    const updated = await Order.findOneAndUpdate(
      { _id: fresh._id },
      { $inc: { 'payment.refundedInr': amount }, $set: { 'payment.refundError': null } },
      { returnDocument: 'after' }
    );
    if (round2(updated.payment.refundedInr) >= round2(paid)) {
      await Order.updateOne({ _id: fresh._id }, { $set: { paymentStatus: PAYMENT_STATUS.REFUNDED } });
    }

    return { refunded: amount, to: 'wallet' };
=======
    const paid = fresh.payment?.paidInr || 0;
    const left = round2(paid - (fresh.payment?.refundedInr || 0));
    const amount = amountInr === null ? left : Math.min(round2(amountInr), left);
    if (amount <= 0) return null;

    const gateway = getGateway(fresh.payment.gateway);
    if (!gateway || !fresh.payment.paymentId) throw new Error('No gateway payment to refund');

    await gateway.refund({ order: fresh, amountInr: amount });

    const refundedTotal = round2((fresh.payment.refundedInr || 0) + amount);
    await Order.updateOne(
      { _id: fresh._id },
      {
        $set: {
          'payment.refundedInr': refundedTotal,
          'payment.refundError': null,
          ...(refundedTotal >= paid ? { paymentStatus: PAYMENT_STATUS.REFUNDED } : {}),
        },
      }
    );
    return { refunded: amount };
>>>>>>> 67b2effa5d75680186ee22954d0086a048c2c0c0
  } catch (err) {
    console.error('Refund failed for order', order?.orderNumber, err.message);
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.refundError': String(err.message).slice(0, 300) } }
    ).catch(() => {});
    return null;
  }
};

module.exports = { refundOrder };
