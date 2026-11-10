const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { getSalesReport, exportSalesReport } = require('../../controllers/admin/salesReportController');

const router = express.Router();

router.get('/export', protect('admin'), exportSalesReport);
router.get('/', protect('admin'), getSalesReport);

module.exports = router;
