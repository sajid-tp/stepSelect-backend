// src/controllers/user/referralController.js   (mounted at /api/referrals)
//   GET /validate?ref=...   public   -> { valid, referrerName? }   (signup page checks a code / invite link)
//   GET /program            public   -> the programme rules (shown on product pages)
//   GET /me                 user     -> my code, invite link, counters
//   GET /eligibility        user     -> can I use the friend's first-order offer?
const referralService = require('../../services/user/referralService');
const STATUS = require('../../constants/statusCodes');

const validate = async (req, res) => {
  const data = await referralService.validateReferral(String(req.query.ref || ''));
  return res.status(STATUS.OK).json({ data });
};

const getProgram = async (req, res) => {
  const data = await referralService.getProgram();
  return res.status(STATUS.OK).json({ data });
};

const getMyReferral = async (req, res) => {
  const data = await referralService.getMyReferral(req.user.id);
  return res.status(STATUS.OK).json({ data });
};

const getEligibility = async (req, res) => {
  const data = await referralService.getEligibility(req.user.id);
  return res.status(STATUS.OK).json({ data });
};

module.exports = { validate, getProgram, getMyReferral, getEligibility };
