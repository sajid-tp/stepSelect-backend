const express = require("express");
const router = express.Router();
const { 
  adminLogin, 
  adminLogout, 
  checkAdminAuth 
} = require('../../controllers/admin/authController');
const { adminProtect } = require('../../middleware/authMiddleware');


router.post('/login', adminLogin);

router.post('/logout', adminLogout);

router.get('/me', adminProtect, checkAdminAuth);

module.exports = router;