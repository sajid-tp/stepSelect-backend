const express = require('express');

const router = express.Router();

const {
  createBrand,
  updateBrand,
  getBrands,
  deleteBrand,
  toggleBrandStatus,
} = require('../../controllers/admin/brandController');

const { protect } = require('../../middleware/authMiddleware');

router.get('/', protect("admin"), getBrands);
router.post('/', protect("admin"), createBrand);
router.patch('/:brandId', protect("admin"), updateBrand);
router.patch('/:brandId/status', protect("admin"), toggleBrandStatus);
router.delete('/:brandId', protect("admin"), deleteBrand);

module.exports = router;