const express = require('express');
const {protect} = require('../../middleware/authMiddleware');
const router = express.Router();
const {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,} = require('../../controllers/user/addressController')

router.get('/', protect("user"), getAddresses);
router.post('/', protect("user"), createAddress);
router.patch('/:id', protect("user"), updateAddress);
router.delete('/:id',protect("user"), deleteAddress);

module.exports =  router;