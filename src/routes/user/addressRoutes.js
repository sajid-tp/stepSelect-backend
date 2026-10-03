const express = require('express');
const {protect} = require('../../middleware/authMiddleware');

const router = express.Router();

const {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,} = require('../../controllers/user/addressController')

router.get('/', protect, getAddresses);
router.post('/', protect, createAddress);
router.patch('/:id', protect, updateAddress);
router.delete('/:id',protect, deleteAddress);

module.exports =  router;