// src/controllers/admin/userController.js
const adminUserService = require('../../services/admin/adminUserServices');

// GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const { statusFilter, search, page, sort } = req.query;

    const data = await adminUserService.getUsers({
      statusFilter,
      sort,
      search,
      page,
      limit: 10,
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};

// PATCH /api/admin/users/:userId/status (or /:userId)
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await adminUserService.toggleUserStatus(userId);

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({
      error: {
        code: err.code || 'SERVER_ERROR',
        message: err.message || 'Something went wrong.',
      },
    });
  }
};


module.exports = {
  getUsers,
  toggleUserStatus,
};