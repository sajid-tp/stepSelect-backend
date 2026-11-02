// src/services/payment/paymentWorker.js
// Background worker (started once from server.js). Every 30 seconds it
//   1. settles payment attempts nobody finished (customer closed the tab), so they count as failed
//   2. closes unpaid orders whose 30 minutes are over: "Payment failed", stock and coupon go back
// The customer does not have to be on the site for this to happen.
const { sweepExpiredOrders } = require('./unpaidOrders');
const { sweepStaleAttempts } = require('./paymentAttempts');

const EVERY_MS = 30 * 1000;
let timer = null;
let running = false;

const runOnce = async () => {
  if (running) return; // never two sweeps at once
  running = true;
  try {
    await sweepStaleAttempts();
    await sweepExpiredOrders();
  } catch (err) {
    console.error('Payment worker failed:', err.message);
  } finally {
    running = false;
  }
};

const startPaymentWorker = () => {
  if (timer) return;
  timer = setInterval(runOnce, EVERY_MS);
  timer.unref();
};

module.exports = { startPaymentWorker, runOnce };
