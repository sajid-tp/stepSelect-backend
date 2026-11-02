// src/services/user/referralService.js
// The referral programme.
//
//   Two ways to refer a friend (both end up in user.referredBy):
//     1. Referral CODE  - "SAJID-7K2Q", typed in the optional field of the signup form
//     2. Invite LINK    - "<client>/invite/<token>", opens the signup page with the friend already linked
//
//   The reward:
//     * the FRIEND gets a flat discount on their first order (if it is big enough)
//     * the REFERRER gets wallet credit once that order is DELIVERED
//   The amounts live in the ReferralSetting document (admin: Offers > Referral Offers).
const crypto = require('crypto');
const User = require('../../models/user');
const Order = require('../../models/order');
const WalletTransaction = require('../../models/walletTransaction');
const ReferralSetting = require('../../models/referralSetting');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');
const { ORDER_STATUS } = require('../../constants/orderConstants');
const { WALLET_SOURCE } = require('../../constants/walletConstants');
const walletService = require('./walletService');

// No 0/O/1/I so a code is easy to read out loud
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomChars = (length) => {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
};

// "Sajid TP" -> "SAJID", "Jo" -> "JO"; falls back to STEP
const codePrefix = (username) => {
  const letters = String(username || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return letters || 'STEP';
};

const settingsView = (s) => ({
  isActive: Boolean(s.isActive),
  referredDiscount: s.referredDiscount,
  minOrderAmount: s.minOrderAmount,
  referrerReward: s.referrerReward,
});

const getProgram = async () => settingsView(await ReferralSetting.getSettings());

const clientOrigin = () => String(process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/+$/, '');

// ---------------------------------------------------------------
// Every customer gets their own code + invite token, created the first time it is needed
// (so customers who signed up before this feature existed get one too).
// ---------------------------------------------------------------
const ensureReferralIdentity = async (userOrId) => {
  const user = typeof userOrId === 'object' && userOrId.save ? userOrId : await User.findById(userOrId);
  if (!user) throw createError(MESSAGES.USER.USER_NOT_FOUND, STATUS.NOT_FOUND, ERROR_CODES.USER_NOT_FOUND);
  if (user.referralCode && user.referralToken) return user;

  for (let attempt = 0; attempt < 8; attempt++) {
    const set = {};
    if (!user.referralCode) set.referralCode = `${codePrefix(user.username)}-${randomChars(4)}`;
    if (!user.referralToken) set.referralToken = crypto.randomBytes(8).toString('hex');

    try {
      // only fills what is still empty, so two requests at once cannot overwrite each other
      const updated = await User.findOneAndUpdate(
        {
          _id: user._id,
          ...(set.referralCode ? { referralCode: null } : {}), // null also matches "field missing"
          ...(set.referralToken ? { referralToken: null } : {}),
        },
        { $set: set },
        { returnDocument: 'after' }
      );
      if (updated) return updated;
      return await User.findById(user._id); // somebody else filled it in the meantime
    } catch (err) {
      if (err.code !== 11000) throw err; // a code collided with another customer: try a new one
    }
  }
  throw createError(MESSAGES.COMMON.SOMETHING_WENT_WRONG, STATUS.SERVER_ERROR);
};

// ---------------------------------------------------------------
// Find the customer behind a code OR an invite token. Returns null when it is not valid.
// ---------------------------------------------------------------
const resolveReferrer = async (ref) => {
  const value = typeof ref === 'string' ? ref.trim() : '';
  if (!value || value.length > 40) return null;

  return User.findOne({
    isVerified: true,
    isBlocked: false,
    $or: [{ referralCode: value.toUpperCase() }, { referralToken: value.toLowerCase() }],
  });
};

// Public: the signup page checks a code / link before the user submits
const validateReferral = async (ref) => {
  const referrer = await resolveReferrer(ref);
  if (!referrer) return { valid: false };
  return { valid: true, referrerName: referrer.username };
};

// Used by signup: a typed code that does not exist is an error the user can fix
const requireReferrer = async (ref) => {
  const referrer = await resolveReferrer(ref);
  if (!referrer) {
    throw createError(MESSAGES.REFERRAL.INVALID_REFERRAL_CODE, STATUS.BAD_REQUEST, ERROR_CODES.REFERRAL_INVALID);
  }
  return referrer;
};

// ---------------------------------------------------------------
// The friend's offer: is this customer allowed it, and how much is it for this cart?
// Allowed = programme is on + signed up with a referral + has no earlier (non-cancelled) order.
// ---------------------------------------------------------------
const getEligibility = async (userId) => {
  const settings = await ReferralSetting.getSettings();
  const base = {
    program: settingsView(settings),
    eligible: false,
    discount: 0,
    minOrderAmount: settings.minOrderAmount,
  };
  if (!settings.isActive || !(settings.referredDiscount > 0)) return base;

  const user = await User.findById(userId).select('referredBy');
  if (!user || !user.referredBy) return base;

  const earlierOrders = await Order.countDocuments({ userId, status: { $ne: ORDER_STATUS.CANCELLED } });
  if (earlierOrders > 0) return base;

  return { ...base, eligible: true, discount: settings.referredDiscount, reward: settings.referrerReward };
};

// For checkout: `base` = the cart value after product / category offers.
const resolveReferralDiscount = async (userId, base) => {
  const info = await getEligibility(userId);
  const amount = Math.max(Number(base) || 0, 0);

  if (!info.eligible) return { eligible: false, discount: 0, reward: 0, minOrderAmount: info.minOrderAmount, hint: null };

  if (amount < info.minOrderAmount) {
    const shortfall = Math.ceil(info.minOrderAmount - amount);
    return {
      eligible: true,
      discount: 0,
      reward: 0,
      minOrderAmount: info.minOrderAmount,
      offerAmount: info.discount,
      hint: amount > 0 ? MESSAGES.REFERRAL.MINIMUM_ORDER_HINT(shortfall, info.discount) : null,
    };
  }

  return {
    eligible: true,
    discount: Math.min(info.discount, amount),
    reward: info.reward || 0,
    minOrderAmount: info.minOrderAmount,
    offerAmount: info.discount,
    hint: null,
  };
};

// ---------------------------------------------------------------
// The referrer is paid when the friend's first order is DELIVERED.
// The wallet idempotency key makes sure one friend can never pay out twice.
// ---------------------------------------------------------------
const rewardReferrerForOrder = async (order) => {
  if (!order || !(order.referralDiscount > 0) || !(order.referralReward > 0)) return null;

  const friend = await User.findById(order.userId).select('username referredBy');
  if (!friend || !friend.referredBy) return null;

  return walletService.creditWallet(friend.referredBy, order.referralReward, {
    source: WALLET_SOURCE.REFERRAL_REWARD,
    description: MESSAGES.REFERRAL.REWARD_DESCRIPTION(friend.username),
    orderId: order._id,
    orderNumber: order.orderNumber,
    idempotencyKey: `REFERRAL_REWARD:${friend._id}`,
  });
};

// ---------------------------------------------------------------
// Account overview card: code, invite link, programme rules and the three counters
// ---------------------------------------------------------------
const getMyReferral = async (userId) => {
  const user = await ensureReferralIdentity(userId);
  const [program, friendsInvited, rewardRows, referrer] = await Promise.all([
    getProgram(),
    User.countDocuments({ referredBy: user._id, isVerified: true }),
    WalletTransaction.aggregate([
      { $match: { userId: user._id, source: WALLET_SOURCE.REFERRAL_REWARD, balanceAfterPaise: { $ne: null } } },
      { $group: { _id: null, count: { $sum: 1 }, totalPaise: { $sum: '$amountPaise' } } },
    ]),
    user.referredBy ? User.findById(user.referredBy).select('username') : null,
  ]);

  const origin = clientOrigin();
  return {
    referralCode: user.referralCode,
    shareLink: `${origin}/invite/${user.referralToken}`,
    program,
    stats: {
      friendsInvited,
      successfulReferrals: rewardRows[0]?.count || 0,
      rewardsEarned: walletService.toRupees(rewardRows[0]?.totalPaise || 0),
    },
    referredBy: referrer ? { name: referrer.username } : null,
  };
};

// ---------------------------------------------------------------
// Admin: edit the programme + a small overview
// ---------------------------------------------------------------
const toMoney = (value, field) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    throw createError(`${field} must be a number between 0 and 1,00,000`, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_OFFER_DATA);
  }
  return Math.round(n);
};

const getAdminReferral = async () => {
  const [program, totalReferred, rewardRows] = await Promise.all([
    getProgram(),
    User.countDocuments({ referredBy: { $ne: null }, isVerified: true }),
    WalletTransaction.aggregate([
      { $match: { source: WALLET_SOURCE.REFERRAL_REWARD, balanceAfterPaise: { $ne: null } } },
      { $group: { _id: null, count: { $sum: 1 }, totalPaise: { $sum: '$amountPaise' } } },
    ]),
  ]);

  return {
    program,
    stats: {
      totalReferred,
      rewardsPaidCount: rewardRows[0]?.count || 0,
      rewardsPaidAmount: walletService.toRupees(rewardRows[0]?.totalPaise || 0),
    },
  };
};

const updateReferralProgram = async (payload = {}) => {
  const update = {};
  if (payload.isActive !== undefined) {
    if (typeof payload.isActive !== 'boolean') {
      throw createError('isActive must be true or false', STATUS.BAD_REQUEST, ERROR_CODES.INVALID_OFFER_DATA);
    }
    update.isActive = payload.isActive;
  }
  if (payload.referredDiscount !== undefined) update.referredDiscount = toMoney(payload.referredDiscount, 'Friend discount');
  if (payload.minOrderAmount !== undefined) update.minOrderAmount = toMoney(payload.minOrderAmount, 'Minimum order amount');
  if (payload.referrerReward !== undefined) update.referrerReward = toMoney(payload.referrerReward, 'Referrer reward');

  if (Object.keys(update).length === 0) {
    throw createError('Provide at least one setting to update', STATUS.BAD_REQUEST, ERROR_CODES.INVALID_OFFER_DATA);
  }

  const current = await ReferralSetting.getSettings();
  const discount = update.referredDiscount ?? current.referredDiscount;
  const minimum = update.minOrderAmount ?? current.minOrderAmount;
  if (discount > minimum) {
    throw createError(
      'The friend discount cannot be more than the minimum order amount',
      STATUS.BAD_REQUEST,
      ERROR_CODES.INVALID_OFFER_DATA
    );
  }

  await ReferralSetting.updateOne({ key: 'default' }, { $set: update });
  return getAdminReferral();
};

module.exports = {
  getProgram,
  ensureReferralIdentity,
  resolveReferrer,
  validateReferral,
  requireReferrer,
  getEligibility,
  resolveReferralDiscount,
  rewardReferrerForOrder,
  getMyReferral,
  getAdminReferral,
  updateReferralProgram,
};
