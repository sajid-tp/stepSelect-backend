const express = require("express");
const router = express.Router();
const { 
  adminLogin, 
  adminLogout, 
} = require('../../controllers/admin/authController');



router.post('/login', adminLogin);

router.post('/logout', adminLogout);



module.exports = router;