const express = require('express');
const router = express.Router();

const {updateVariant,getVariants,getVariant,deleteVariant,toggleVariantStatus,addVariant} = require('../../controllers/admin/variantController');

router.get('/products/:productId/variants', getVariants);
router.get('/:variantId',getVariant);
router.post('/:productId/variants',addVariant);
router.patch('/:variantId', updateVariant);
router.delete('/:variantId',deleteVariant);
router.patch('/:variantId/status',toggleVariantStatus);

module.exports = router;