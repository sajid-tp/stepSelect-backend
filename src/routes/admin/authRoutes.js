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

// Session check used by the client's AdminProtectedRoute
router.get('/me', protect('admin'), adminMe);



module.exports = router;