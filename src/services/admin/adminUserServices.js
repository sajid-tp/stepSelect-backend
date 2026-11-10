const User = require('../../models/user');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');
const ERROR_CODES = require('../../constants/errorCodes');

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { username: 1 },
  name_desc: { username: -1 },
  email_asc: { email: 1 },
  email_desc: { email: -1 },
};

// Get users
const getUsers = async ({ search, page = 1, limit = 10, sort, status }) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const filter = { isVerified: true };

  if (status === 'active') filter.isBlocked = false;
  if (status === 'blocked') filter.isBlocked = true;

  const searchText = (search || '').trim();
  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ username: regex }, { email: regex }];
  }

  
  const totalResults = await User.countDocuments(filter);
  const totalCustomers = await User.countDocuments({ isVerified: true });
  const totalPages = Math.ceil(totalResults / limitNum) || 1;


  const users = await User.find(filter)
    .select('username email createdAt isBlocked')
    .sort({ ...(SORT_MAP[sort] || SORT_MAP.name_asc), _id: -1 })
    .collation({ locale: 'en', strength: 2 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

 

  const formattedUsers = users.map((u) => ({
    id: u._id,
    username: u.username,
    email: u.email,
    joinedOn: u.createdAt,
    isBlocked: u.isBlocked,
  }));

  return {
    users: formattedUsers,
    totalCustomers,
    page: pageNum,
    limit: limitNum,
    totalResults,
    totalPages,
  };
};

// User status
const toggleUserStatus = async (userId) => {
  const existingUser = await User.findById(userId);

  if (!existingUser) {
    throw createError(MESSAGES.USER.NO_USER_EXISTS_WITH_THIS_ID, STATUS.NOT_FOUND, ERROR_CODES.USER_NOT_FOUND);
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { isBlocked: !existingUser.isBlocked },
    { new: true }
  ).select('isBlocked');

  return {
    id: updatedUser._id,
    isBlocked: updatedUser.isBlocked,
  };
};

module.exports = {
  getUsers,
  toggleUserStatus,
};


