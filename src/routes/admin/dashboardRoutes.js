const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getDashboard } = require('../../controllers/admin/dashboardController');

const router = express.Router();

router.get('/', protect('admin'), getDashboard);

module.exports = router;
