const express = require('express');
const router = express.Router();

const {updateVariant,getVariants,getVariant,deleteVariant,toggleVariantStatus,addVariant} = require('../../controllers/admin/variantController');
const {protect} = require('../../middleware/authMiddleware')
router.get('/products/:productId/variants', protect("admin"), getVariants);
router.get('/:variantId', protect("admin"), getVariant);
router.post('/:productId/variants', protect("admin"), addVariant);
router.patch('/:variantId',protect("admin"), updateVariant);
router.delete('/:variantId',protect("admin"),deleteVariant);
router.patch('/:variantId/status',protect("admin"),toggleVariantStatus);

module.exports = router;