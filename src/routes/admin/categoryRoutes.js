const express = require("express");
const router = express.Router();
const {createCategory,updateCategory,getCategories, deleteCategory, toggleCategoryStatus} = require('../../controllers/admin/categoryController'); 

const { adminProtect } = require('../../middleware/authMiddleware');

router.get('/',getCategories)
router.post('/', createCategory);
router.patch('/:categoryId',updateCategory);
router.patch('/:categoryId/status',toggleCategoryStatus);
router.delete('/:categoryId',deleteCategory);

module.exports = router;