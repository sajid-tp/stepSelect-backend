const express = require("express");
const router = express.Router();
const { 
  adminLogin, 
  adminLogout, 
  adminMe,
} = require('../../controllers/admin/authController');
const { protect } = require('../../middleware/authMiddleware');



router.post('/login', adminLogin);

router.post('/logout', adminLogout);

router.get('/me', protect('admin'), adminMe);



module.exports = router;