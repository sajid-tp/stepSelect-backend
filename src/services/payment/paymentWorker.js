const { sweepExpiredOrders } = require('./unpaidOrders');
const { sweepStaleAttempts } = require('./paymentAttempts');

const EVERY_MS = 30 * 1000;
let timer = null;
let running = false;

const runOnce = async () => {
  if (running) return;
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
