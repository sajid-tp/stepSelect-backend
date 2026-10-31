// src/controllers/admin/dashboardController.js
const dashboardService = require('../../services/admin/adminDashboardServices');
const STATUS = require('../../constants/statusCodes');

/*
  GET /api/admin/dashboard?period=daily|weekly|monthly|yearly|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
*/
const getDashboard = async (req, res) => {
  const { period, from, to } = req.query;
  const data = await dashboardService.getDashboard({ period, from, to });
  return res.status(STATUS.OK).json({ data });
};

module.exports = { getDashboard };
