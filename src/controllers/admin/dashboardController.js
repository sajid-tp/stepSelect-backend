const dashboardService = require('../../services/admin/adminDashboardServices');
const STATUS = require('../../constants/statusCodes');

// Get dashboard
const getDashboard = async (req, res) => {
  const { period, from, to } = req.query;
  const data = await dashboardService.getDashboard({ period, from, to });
  return res.status(STATUS.OK).json({ data });
};

module.exports = { getDashboard };
