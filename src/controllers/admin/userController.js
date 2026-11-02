// src/controllers/admin/userController.js
const adminUserService = require('../../services/admin/adminUserServices');
const STATUS = require('../../constants/statusCodes');

// GET /api/admin/users
const getUsers = async (req, res) => {
  const { statusFilter, search, page, sort } = req.query;

  const data = await adminUserService.getUsers({
    statusFilter,
    sort,
    search,
    page,
    limit: 10,
  });

  return res.status(STATUS.OK).json(data);
};

// PATCH /api/admin/users/:userId/status (or /:userId)
const toggleUserStatus = async (req, res) => {
  const { userId } = req.params;

  const result = await adminUserService.toggleUserStatus(userId);

  return res.status(STATUS.OK).json(result);
};


module.exports = {
  getUsers,
  toggleUserStatus,
};