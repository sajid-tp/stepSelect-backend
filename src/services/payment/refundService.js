// src/services/payment/refundService.js
// Money back for an online-paid order when it is cancelled or a return is approved.
// Cash on Delivery orders (and unpaid ones) are ignored, so callers can call this blindly.
const Order = require('../../models/order');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../../constants/orderConstants');
const { getGateway } = require('./gateways');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// amountInr = null  ->  refund everything that is still left
// Never throws: a gateway problem must not undo a cancellation that already happened.
// The failure is stored on the order (payment.refundError) so the admin can see it.
const refundOrder = async (order, amountInr = null) => {
  try {
    if (!order || order.paymentMethod === PAYMENT_METHODS.COD) return null;

    // Read fresh numbers: the order object in the caller can be a little old
    const fresh = await Order.findById(order._id);
    if (!fresh || fresh.paymentStatus !== PAYMENT_STATUS.PAID) return null;

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
