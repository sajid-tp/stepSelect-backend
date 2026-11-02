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

// Create a Razorpay order the checkout popup pays against.
// Used for shop orders (createPayment below) and for wallet top-ups.
//   amountInr -> rupees to charge     receipt -> our own reference (max 40 characters)
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
    // Everything the browser needs to open the popup
    clientData: {
      key: keyId(),
      razorpayOrderId: created.id,
      amount: created.amount,
      currency: created.currency,
    },
  };
};

// The popup data for a Razorpay order that ALREADY exists (used when the customer retries).
// A Razorpay order accepts many payment attempts, so a retry does not need a new one:
// every attempt just becomes one more payment id under the same order id.
// Returns null when the saved id belongs to the other mode (demo vs real), so the caller makes a new one.
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

// Payment for a shop order
const createPayment = ({ order }) =>
  createGatewayOrder({
    amountInr: order.totalAmount,
    receipt: order.orderNumber,
    notes: { orderNumber: order.orderNumber },
  });

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

// The ids of the payments that FAILED under one Razorpay order, asked from Razorpay itself.
// This is the reliable way to count failed tries: it does not depend on what the browser sends.
// (Demo mode has no real Razorpay, so it returns nothing and the browser's own report is used.)
const listFailedPaymentIds = async (gatewayOrderId) => {
  if (isDemo() || !gatewayOrderId) return [];
  const json = await call('GET', `/orders/${gatewayOrderId}/payments`);
  return (json.items || []).filter((p) => p.status === 'failed').map((p) => String(p.id));
};

// The id of a payment under this Razorpay order that was really paid (status captured), or null.
// Used before a retry: if the customer already paid (slow UPI, a closed tab, a late webhook) we mark the
// order paid instead of asking them to pay a second time.
// (Demo mode has no real Razorpay to ask, so it returns null.)
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
