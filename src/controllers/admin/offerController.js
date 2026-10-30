const offerService = require('../../services/admin/adminOfferServices');
const STATUS = require('../../constants/statusCodes');

const getOffers = async (req, res) => res.status(STATUS.OK).json(await offerService.getOffers(req.query));
const getOfferOptions = async (req, res) => res.status(STATUS.OK).json(await offerService.getOfferOptions(req.query));
const createOffer = async (req, res) => res.status(STATUS.CREATED).json(await offerService.createOffer(req.body || {}));
const getOfferById = async (req, res) => res.status(STATUS.OK).json(await offerService.getOfferById(req.params.offerId));
const updateOffer = async (req, res) => res.status(STATUS.OK).json(await offerService.updateOffer(req.params.offerId, req.body || {}));
const setOfferStatus = async (req, res) => res.status(STATUS.OK).json(await offerService.setOfferStatus(req.params.offerId));
const deleteOffer = async (req, res) => res.status(STATUS.OK).json(await offerService.deleteOffer(req.params.offerId));
const getReferral = async (req, res) => res.status(STATUS.OK).json(await offerService.getReferral());
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
