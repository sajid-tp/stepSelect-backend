const Order = require('../../models/order');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../../constants/orderConstants');
const { WALLET_SOURCE } = require('../../constants/walletConstants');
const { creditWallet } = require('../user/walletService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const refundOrder = async (order, amountInr = null, { reason = 'cancel', note = '' } = {}) => {
  try {
    if (!order) return null;

    const fresh = await Order.findById(order._id);
    if (!fresh) return null;

    const isCod = fresh.paymentMethod === PAYMENT_METHODS.COD;
    if (isCod ? reason !== 'return' : fresh.paymentStatus !== PAYMENT_STATUS.PAID) return null;
    const paid = fresh.payment?.paidInr || (isCod ? fresh.totalAmount : 0);
    const refundedBefore = round2(fresh.payment?.refundedInr || 0);
    const left = round2(paid - refundedBefore);
    const amount = amountInr === null ? left : Math.min(round2(amountInr), left);
    if (amount <= 0) return null;

    const isReturn = reason === 'return';
    const description = isReturn
      ? `Refund for returned item${note ? ` (${note})` : ''}, order ${fresh.orderNumber}`
      : `Refund for cancelled order ${fresh.orderNumber}${note ? ` (${note})` : ''}`;

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
