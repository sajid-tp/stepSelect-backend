const express = require('express');
const router = express.Router();

const {
  updateVariant,
} = require('../../controllers/admin/variantController');

const {
  adminProtect,
} = require('../../middleware/authMiddleware');

router.patch('/:variantId', updateVariant);

module.exports = router;