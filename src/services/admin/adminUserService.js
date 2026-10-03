// src/services/adminUserService.js
const User = require('../../models/user');

const createError = (message, statusCode = 400, code = 'BAD_REQUEST') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

// 1. Get Paginated & Filtered Users
const getUsers = async ({ search, page = 1, limit = 10 ,sort}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const filter = { isVerified: true };

  // Status filtering
  // if (statusFilter === 'active') filter.isBlocked = false;
  // if (statusFilter === 'blocked') filter.isBlocked = true;
  // Search filtering
  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or = [{ username: regex }, { email: regex }];
  }

  // Count total matches
  const totalResults = await User.countDocuments(filter);
  const totalPages = Math.ceil(totalResults / limitNum) || 1;

  // Fetch paginated documents
  const users = await User.find(filter)
    .select('username email createdAt isBlocked')
    .sort({ username: 1 })
    .collation({ locale: 'en', strength: 1 })
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
    totalCustomers: totalResults,
    page: pageNum,
    limit: limitNum,
    totalResults,
    totalPages,
  };
};

// 2. Toggle User Block Status
const toggleUserStatus = async (userId) => {
  const existingUser = await User.findById(userId);

  if (!existingUser) {
    throw createError('No user exists with this id.', 404, 'USER_NOT_FOUND');
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


// const getUsersTest = async() =>{

//   const reg = new RegExp("r");
//   const blocked = true;
//   const filter = {isBlocked : blocked};
//   filter = {username :reg};

//  const users = await User.find(filter);
//  const formattedUsers = users.map((u) => ({
//     id: u._id,
//     username: u.username,
//     email: u.email,
//     joinedOn: u.createdAt,
//     isBlocked: u.isBlocked,
//   }));
  
//   return formattedUsers;

// }