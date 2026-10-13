const express = require("express");
const router = express.Router();
const {createCategory,updateCategory,getCategories, deleteCategory, toggleCategoryStatus} = require('../../controllers/admin/categoryController'); 

const { protect } = require('../../middleware/authMiddleware');

router.get('/',protect("admin"), getCategories)
router.post('/', protect("admin"), createCategory);
router.patch('/:categoryId', protect("admin"), updateCategory);
router.patch('/:categoryId/status', protect("admin"), toggleCategoryStatus);
router.delete('/:categoryId',protect("admin"), deleteCategory);

module.exports = router;