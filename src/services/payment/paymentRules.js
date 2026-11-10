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

const CLOSED_REASON = Object.freeze({
  EXPIRED: 'expired',
  EXHAUSTED: 'exhausted',
  ABANDONED: 'abandoned',
});

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

const isUnpaidOnline = (order) =>
  Boolean(order) &&
  order.paymentMethod !== PAYMENT_METHODS.COD &&
  [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED].includes(order.paymentStatus);

const holdExpiresAt = (order) =>
  new Date((order.createdAt ? new Date(order.createdAt).getTime() : Date.now()) + holdMinutes() * 60 * 1000);
const isHoldExpired = (order, now = Date.now()) => holdExpiresAt(order).getTime() <= now;

const attemptDeadline = (order) => {
  const startedAt = order.payment?.lastAttemptAt;
  return startedAt ? new Date(new Date(startedAt).getTime() + attemptWindowMinutes() * 60 * 1000) : null;
};

const isAttemptInProgress = (order, now = Date.now()) => {
  if (!order.payment?.attemptOpen) return false;
  const deadline = attemptDeadline(order);
  return !deadline || deadline.getTime() > now;
};

const describeRetryState = (order, now = Date.now()) => {
  const unpaid = isUnpaidOnline(order);
  const held = unpaid && order.status === ORDER_STATUS.PENDING;

  const max = maxAttempts();
  const attemptsUsed = order.payment?.attempts || 0;
  const failedAttempts = order.payment?.attemptHistory?.length || 0;
  const expiresAt = holdExpiresAt(order);
  const secondsLeft = held ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000)) : 0;
  const attemptInProgress = held && isAttemptInProgress(order, now);

  const needsCooldown = attemptsUsed >= immediateAttempts() && attemptsUsed < max && !attemptInProgress;
  let failedAtMs = order.payment?.lastFailedAt ? new Date(order.payment.lastFailedAt).getTime() : null;
  if (held && order.payment?.attemptOpen && !attemptInProgress) {
    const deadline = attemptDeadline(order);
    if (deadline) failedAtMs = deadline.getTime();
  }
  const cooldownEndsAtMs = needsCooldown && failedAtMs ? failedAtMs + cooldownSeconds() * 1000 : null;
  const cooldownSecondsLeft = cooldownEndsAtMs ? Math.max(0, Math.ceil((cooldownEndsAtMs - now) / 1000)) : 0;

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

  const cooldownOutlastsHold = held && closedReason === null && cooldownSecondsLeft > 0 && cooldownSecondsLeft > secondsLeft;

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
