const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getOffers,
  getOfferOptions,
  createOffer,
  getOfferById,
  updateOffer,
  setOfferStatus,
  deleteOffer,
  getReferral,
  updateReferral,
} = require('../../controllers/admin/offerController');

router.use(protect('admin'));

// fixed paths first, so "/options" and "/referral" are not read as an :offerId
router.get('/options', getOfferOptions);
router.get('/referral', getReferral);
router.put('/referral', updateReferral);

router.get('/', getOffers);
router.post('/', createOffer);
router.get('/:offerId', getOfferById);
router.patch('/:offerId', updateOffer);
router.patch('/:offerId/status', setOfferStatus);
router.delete('/:offerId', deleteOffer);

module.exports = router;
