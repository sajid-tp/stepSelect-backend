const adminUserService = require('../../services/admin/adminUserServices');
const STATUS = require('../../constants/statusCodes');

// Get users
const getUsers = async (req, res) => {
  const { status, search, page, sort } = req.query;

  const data = await adminUserService.getUsers({
    status,
    sort,
    search,
    page,
    limit: 10,
  });

  return res.status(STATUS.OK).json(data);
};

// User status
const toggleUserStatus = async (req, res) => {
  const { userId } = req.params;

  const result = await adminUserService.toggleUserStatus(userId);

  return res.status(STATUS.OK).json(result);
};


module.exports = {
  getUsers,
  toggleUserStatus,
};