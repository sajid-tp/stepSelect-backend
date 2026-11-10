const offerService = require('../../services/admin/adminOfferServices');
const STATUS = require('../../constants/statusCodes');

// Get offers
const getOffers = async (req, res) => res.status(STATUS.OK).json(await offerService.getOffers(req.query));
// Offer options
const getOfferOptions = async (req, res) => res.status(STATUS.OK).json(await offerService.getOfferOptions(req.query));
// Create offer
const createOffer = async (req, res) => res.status(STATUS.CREATED).json(await offerService.createOffer(req.body || {}));
// Get offer
const getOfferById = async (req, res) => res.status(STATUS.OK).json(await offerService.getOfferById(req.params.offerId));
// Update offer
const updateOffer = async (req, res) => res.status(STATUS.OK).json(await offerService.updateOffer(req.params.offerId, req.body || {}));
// Offer status
const setOfferStatus = async (req, res) => res.status(STATUS.OK).json(await offerService.setOfferStatus(req.params.offerId));
// Delete offer
const deleteOffer = async (req, res) => res.status(STATUS.OK).json(await offerService.deleteOffer(req.params.offerId));
// Get referral
const getReferral = async (req, res) => res.status(STATUS.OK).json(await offerService.getReferral());
// Update referral
const updateReferral = async (req, res) => res.status(STATUS.OK).json(await offerService.updateReferral(req.body || {}));

module.exports = {
  getOffers,
  getOfferOptions,
  createOffer,
  getOfferById,
  updateOffer,
  setOfferStatus,
  deleteOffer,
  getReferral,
  updateReferral,
};
