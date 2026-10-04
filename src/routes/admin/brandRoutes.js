const express = require('express');

const router = express.Router();

const {
  createBrand,
  updateBrand,
  getBrands,
  deleteBrand,
  toggleBrandStatus,
} = require('../../controllers/admin/brandController');

// const { adminProtect } = require('../../middleware/authMiddleware');

router.get('/', getBrands);
router.post('/', createBrand);
router.patch('/:brandId', updateBrand);
router.patch('/:brandId/status',toggleBrandStatus);
router.delete('/:brandId', deleteBrand);

module.exports = router;