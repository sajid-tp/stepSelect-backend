// src/services/payment/paymentRules.js
// THE business rules for an online (Razorpay) payment, in one place. No database code here,
// only numbers and pure functions, so the payment service, the order service and the worker
// all read the same rules.
//
//   1. The order holds its stock for 30 minutes from the moment it is created.
//      Retries NEVER extend this clock. When it runs out, the stock goes back on the shelf.
//   2. The customer gets 4 payment attempts in total:
//        attempts 1, 2 and 3 -> can be tried one after the other (no waiting)
//        attempt  4          -> the FINAL attempt, opens only after a 2 minute cool-down
//                               counted from the moment the 3rd attempt failed
//   3. When the 4th attempt fails (or the 30 minutes end first), the order is closed as
//      "Payment failed": it stays in Order History, the stock is restocked, the coupon is returned.
//
// Everything can be changed from .env (defaults are the business rules above):
//   PAYMENT_HOLD_MINUTES          30
//   PAYMENT_MAX_ATTEMPTS          4
//   PAYMENT_IMMEDIATE_ATTEMPTS    3     (attempts allowed with no waiting)
//   PAYMENT_COOLDOWN_SECONDS      120   (wait before the final attempt)
//   PAYMENT_ATTEMPT_WINDOW_MINUTES 3    (an attempt nobody finished is treated as failed after this long)
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require('../../constants/orderConstants');

const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const holdMinutes = () => positive(process.env.PAYMENT_HOLD_MINUTES, 30);
const maxAttempts = () => Math.floor(positive(process.env.PAYMENT_MAX_ATTEMPTS, 4));
const immediateAttempts = () =>
  Math.min(Math.floor(positive(process.env.PAYMENT_IMMEDIATE_ATTEMPTS, 3)), maxAttempts() - 1);
const cooldownSeconds = () => positive(process.env.PAYMENT_COOLDOWN_SECONDS, 120);
const attemptWindowMinutes = () => positive(process.env.PAYMENT_ATTEMPT_WINDOW_MINUTES, 3);

// Why an unpaid order was closed (saved on the order as payment.closedReason)
const CLOSED_REASON = Object.freeze({
  EXPIRED: 'expired', //     the 30 minutes ran out
  EXHAUSTED: 'exhausted', // all 4 attempts failed
  ABANDONED: 'abandoned', // the customer left, cancelled the payment or paid another way
});

// Text saved as the order's cancelReason / item history note
const RELEASE_REASON = Object.freeze({
  TIMED_OUT: 'Payment failed: the 30 minute payment time ran out',
  EXHAUSTED: 'Payment failed: all payment attempts were used',
  ABANDONED: 'Payment cancelled by customer',
});

const closedReasonForRelease = (reason) => {
  if (reason === RELEASE_REASON.TIMED_OUT) return CLOSED_REASON.EXPIRED;
  if (reason === RELEASE_REASON.EXHAUSTED) return CLOSED_REASON.EXHAUSTED;
  return CLOSED_REASON.ABANDONED;
};

// An online order whose payment has not been completed (COD never counts)
const isUnpaidOnline = (order) =>
  Boolean(order) &&
  order.paymentMethod !== PAYMENT_METHODS.COD &&
  [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED].includes(order.paymentStatus);

const holdExpiresAt = (order) =>
  new Date((order.createdAt ? new Date(order.createdAt).getTime() : Date.now()) + holdMinutes() * 60 * 1000);
const isHoldExpired = (order, now = Date.now()) => holdExpiresAt(order).getTime() <= now;

// When an attempt that nobody finished counts as failed (the customer closed the tab, lost network ...)
const attemptDeadline = (order) => {
  const startedAt = order.payment?.lastAttemptAt;
  return startedAt ? new Date(new Date(startedAt).getTime() + attemptWindowMinutes() * 60 * 1000) : null;
};

const isAttemptInProgress = (order, now = Date.now()) => {
  if (!order.payment?.attemptOpen) return false;
  const deadline = attemptDeadline(order);
  return !deadline || deadline.getTime() > now;
};

// The whole payment situation of one order, as numbers the screens can show.
const describeRetryState = (order, now = Date.now()) => {
  const unpaid = isUnpaidOnline(order);
  const held = unpaid && order.status === ORDER_STATUS.PENDING; // still holding its stock

  const max = maxAttempts();
  const attemptsUsed = order.payment?.attempts || 0;
  const failedAttempts = order.payment?.attemptHistory?.length || 0;
  const expiresAt = holdExpiresAt(order);
  const secondsLeft = held ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000)) : 0;
  const attemptInProgress = held && isAttemptInProgress(order, now);

  // The cool-down only exists before the FINAL attempt (everything after the free attempts).
  // It is not shown while an attempt is still running: lastFailedAt then belongs to the PREVIOUS attempt.
  const needsCooldown = attemptsUsed >= immediateAttempts() && attemptsUsed < max && !attemptInProgress;
  let failedAtMs = order.payment?.lastFailedAt ? new Date(order.payment.lastFailedAt).getTime() : null;
  // A stale unfinished attempt is treated as failed at the moment its window ended
  if (held && order.payment?.attemptOpen && !attemptInProgress) {
    const deadline = attemptDeadline(order);
    if (deadline) failedAtMs = deadline.getTime();
  }
  const cooldownEndsAtMs = needsCooldown && failedAtMs ? failedAtMs + cooldownSeconds() * 1000 : null;
  const cooldownSecondsLeft = cooldownEndsAtMs ? Math.max(0, Math.ceil((cooldownEndsAtMs - now) / 1000)) : 0;

  // Why online payment is closed for this order (null while it can still be tried)
  let closedReason = null;
  if (order.status === ORDER_STATUS.CANCELLED || (unpaid && order.status !== ORDER_STATUS.PENDING)) {
    closedReason = order.payment?.closedReason || 'cancelled';
  } else if (held) {
    if (expiresAt.getTime() <= now) closedReason = CLOSED_REASON.EXPIRED;
    else if (attemptsUsed >= max && !attemptInProgress) closedReason = CLOSED_REASON.EXHAUSTED;
  }

  const canRetry =
    held &&
    closedReason === null &&
    attemptsUsed < max &&
    !attemptInProgress &&
    cooldownSecondsLeft === 0;

  // The cool-down ends after the 30 minute hold does: the final attempt can never open
  const cooldownOutlastsHold = held && closedReason === null && cooldownSecondsLeft > 0 && cooldownSecondsLeft > secondsLeft;

  // Is the attempt that would start next the final one?
  const nextAttemptIsFinal = held && attemptsUsed + 1 === max;

  return {
    attemptsUsed,
    failedAttempts,
    maxAttempts: max,
    attemptsLeft: Math.max(0, max - attemptsUsed),
    immediateAttempts: immediateAttempts(),
    nextAttemptNumber: Math.min(attemptsUsed + 1, max),
    nextAttemptIsFinal,
    attemptInProgress,
    cooldownSeconds: cooldownSeconds(),
    cooldownSecondsLeft,
    cooldownOutlastsHold,
    cooldownEndsAt: cooldownEndsAtMs && cooldownSecondsLeft > 0 ? new Date(cooldownEndsAtMs).toISOString() : null,
    holdMinutes: holdMinutes(),
    holdExpiresAt: expiresAt.toISOString(),
    secondsLeft,
    canRetry,
    closedReason,
  };
};

// The status the CUSTOMER sees for an order in Order History / Order Details.
//   payment_failed  -> online payment is over: the 4th attempt failed, or the 30 minutes ran out (stock restocked)
//   payment_pending -> still holding its stock, the customer may still pay or retry
// Everything else is the normal order status.
const getDisplayStatus = (order) => {
  if (order.paymentMethod !== PAYMENT_METHODS.COD && order.status === ORDER_STATUS.CANCELLED && order.paymentStatus === PAYMENT_STATUS.FAILED) {
    return 'payment_failed';
  }
  if (isUnpaidOnline(order) && order.status === ORDER_STATUS.PENDING) return 'payment_pending';
  return order.status;
};

module.exports = {
  getDisplayStatus,
  holdMinutes,
  maxAttempts,
  immediateAttempts,
  cooldownSeconds,
  attemptWindowMinutes,
  CLOSED_REASON,
  RELEASE_REASON,
  closedReasonForRelease,
  isUnpaidOnline,
  holdExpiresAt,
  isHoldExpired,
  attemptDeadline,
  isAttemptInProgress,
  describeRetryState,
};
