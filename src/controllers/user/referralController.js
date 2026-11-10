const referralService = require('../../services/user/referralService');
const STATUS = require('../../constants/statusCodes');

// Validate referral
const validate = async (req, res) => {
  const data = await referralService.validateReferral(String(req.query.ref || ''));
  return res.status(STATUS.OK).json({ data });
};

// Referral program
const getProgram = async (req, res) => {
  const data = await referralService.getProgram();
  return res.status(STATUS.OK).json({ data });
};

// My referral
const getMyReferral = async (req, res) => {
  const data = await referralService.getMyReferral(req.user.id);
  return res.status(STATUS.OK).json({ data });
};

// Referral eligibility
const getEligibility = async (req, res) => {
  const data = await referralService.getEligibility(req.user.id);
  return res.status(STATUS.OK).json({ data });
};

module.exports = { validate, getProgram, getMyReferral, getEligibility };
