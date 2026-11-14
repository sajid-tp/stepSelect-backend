const express = require("express");
const router = express.Router();
const { 
  adminLogin, 
  adminLogout, 
  adminMe,
} = require('../../controllers/admin/authController');
const { protect } = require('../../middleware/authMiddleware');
const { adminLoginLimiter } = require('../../middleware/rateLimiter');



router.post('/login', adminLoginLimiter, adminLogin);

router.post('/logout', adminLogout);

// Session check used by the client's AdminProtectedRoute
router.get('/me', protect('admin'), adminMe);



module.exports = router;