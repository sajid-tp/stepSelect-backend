const crypto = require('crypto');
const createError = require('../../../utils/createError');
const STATUS = require('../../../constants/statusCodes');

const API = 'https://api.razorpay.com/v1';

const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;

const isDemo = () =>
  !keyId() && !keySecret() && String(process.env.RAZORPAY_DEMO_MODE).toLowerCase() === 'true';

const DEMO_SIGNATURE = 'demo_signature';
const demoId = (prefix) => `${prefix}_demo_${crypto.randomBytes(7).toString('hex')}`;

const isConfigured = () => Boolean((keyId() && keySecret()) || isDemo());

const call = async (method, path, body) => {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error('Razorpay request failed:', err.message);
    throw createError('Could not reach Razorpay. Please try again.', STATUS.SERVICE_UNAVAILABLE);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.description || 'Razorpay rejected the request.';
    console.error('Razorpay error:', res.status, message);
    throw createError(message, res.status >= 500 ? STATUS.SERVICE_UNAVAILABLE : STATUS.BAD_REQUEST);
  }
  return json;
};

const toPaise = (inr) => Math.round(Number(inr) * 100);

const createGatewayOrder = async ({ amountInr, receipt, notes = {} }) => {
  if (isDemo()) {
    const id = demoId('order');
    return {
      gatewayOrderId: id,
      currency: 'INR',
      chargedAmount: amountInr,
      clientData: {
        demo: true,
        key: 'rzp_demo',
        razorpayOrderId: id,
        amount: toPaise(amountInr),
        currency: 'INR',
      },
    };
  }

  const created = await call('POST', '/orders', {
    amount: toPaise(amountInr),
    currency: 'INR',
    receipt,
    notes,
  });

  return {
    gatewayOrderId: created.id,
    currency: 'INR',
    chargedAmount: amountInr,
    clientData: {
      key: keyId(),
      razorpayOrderId: created.id,
      amount: created.amount,
      currency: created.currency,
    },
  };
};

const describeOrder = ({ gatewayOrderId, amountInr }) => {
  if (!gatewayOrderId || String(gatewayOrderId).startsWith('order_demo_') !== isDemo()) return null;

  return {
    gatewayOrderId,
    currency: 'INR',
    chargedAmount: amountInr,
    clientData: isDemo()
      ? { demo: true, key: 'rzp_demo', razorpayOrderId: gatewayOrderId, amount: toPaise(amountInr), currency: 'INR' }
      : { key: keyId(), razorpayOrderId: gatewayOrderId, amount: toPaise(amountInr), currency: 'INR' },
  };
};

const createPayment = ({ order }) =>
  createGatewayOrder({
    amountInr: order.totalAmount,
    receipt: order.orderNumber,
    notes: { orderNumber: order.orderNumber },
  });

const verifySignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;

  if (isDemo()) {
    return (
      String(orderId).startsWith('order_demo_') &&
      String(paymentId).startsWith('pay_demo_') &&
      signature === DEMO_SIGNATURE
    );
  }

  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const verifyWebhookSignature = (rawBody, signature) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const listFailedPaymentIds = async (gatewayOrderId) => {
  if (isDemo() || !gatewayOrderId) return [];
  const json = await call('GET', `/orders/${gatewayOrderId}/payments`);
  return (json.items || []).filter((p) => p.status === 'failed').map((p) => String(p.id));
};

const findCapturedPaymentId = async (gatewayOrderId) => {
  if (isDemo() || !gatewayOrderId) return null;
  const json = await call('GET', `/orders/${gatewayOrderId}/payments`);
  const paid = (json.items || []).find((p) => p.status === 'captured');
  return paid ? String(paid.id) : null;
};

const refund = async ({ order, amountInr }) => {
  if (isDemo()) return { id: demoId('rfnd'), demo: true, amount: toPaise(amountInr) };

  return call('POST', `/payments/${order.payment.paymentId}/refund`, {
    amount: toPaise(amountInr),
    notes: { orderNumber: order.orderNumber },
  });
};

module.exports = { name: 'RAZORPAY', isConfigured, isDemo, createGatewayOrder, describeOrder, createPayment, verifySignature, verifyWebhookSignature, listFailedPaymentIds, findCapturedPaymentId, refund };
