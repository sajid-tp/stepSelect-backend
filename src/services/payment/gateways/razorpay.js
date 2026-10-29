// src/services/payment/gateways/razorpay.js
// Razorpay through its REST API (no SDK needed, Node 18+ has fetch built in).
//   .env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (optional)
//
// Two ways to run it:
//   1. Razorpay TEST mode: put your rzp_test_ key id + secret in .env. The real Razorpay popup opens
//      and you pay with Razorpay's test cards / test UPI. No real money moves.
//   2. Built-in DEMO mode: leave both keys empty and set RAZORPAY_DEMO_MODE=true. No Razorpay account
//      is needed: the browser shows a look-alike Razorpay popup and the server accepts its fake payment.
//      This is only for showing the project. Never switch it on for a real shop.
const crypto = require('crypto');
const createError = require('../../../utils/createError');
const STATUS = require('../../../constants/statusCodes');

const API = 'https://api.razorpay.com/v1';

const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;

// Demo mode only works while there are NO real keys, so it can never replace a real gateway
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

// Create the Razorpay order the checkout popup pays against.
const createPayment = async ({ order }) => {
  if (isDemo()) {
    const id = demoId('order');
    return {
      gatewayOrderId: id,
      currency: 'INR',
      chargedAmount: order.totalAmount,
      clientData: {
        demo: true,
        key: 'rzp_demo',
        razorpayOrderId: id,
        amount: toPaise(order.totalAmount),
        currency: 'INR',
      },
    };
  }

  const created = await call('POST', '/orders', {
    amount: toPaise(order.totalAmount),
    currency: 'INR',
    receipt: order.orderNumber,
    notes: { orderNumber: order.orderNumber },
  });

  return {
    gatewayOrderId: created.id,
    currency: 'INR',
    chargedAmount: order.totalAmount,
    // Everything the browser needs to open the popup
    clientData: {
      key: keyId(),
      razorpayOrderId: created.id,
      amount: created.amount,
      currency: created.currency,
    },
  };
};

// Razorpay signs "<order_id>|<payment_id>" with the key secret.
const verifySignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;

  // Demo popup: it has no secret to sign with, so accept only its own fake ids
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

const refund = async ({ order, amountInr }) => {
  if (isDemo()) return { id: demoId('rfnd'), demo: true, amount: toPaise(amountInr) };

  return call('POST', `/payments/${order.payment.paymentId}/refund`, {
    amount: toPaise(amountInr),
    notes: { orderNumber: order.orderNumber },
  });
};

module.exports = { name: 'RAZORPAY', isConfigured, isDemo, createPayment, verifySignature, verifyWebhookSignature, refund };
