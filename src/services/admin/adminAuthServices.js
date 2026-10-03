// src/services/adminAuthServices.js
const { generateAdminToken } = require('../../utils/jwt');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const loginAdmin = async (email, password) => {
  const isValidEmail = email === process.env.ADMIN_EMAIL;
  const isValidPassword = password === process.env.ADMIN_PASSWORD;

  if (!isValidEmail || !isValidPassword) {
    throw createError('Invalid admin credentials', 401);
  }

  const token = generateAdminToken();

  return { token };
};

module.exports = {
  loginAdmin,
};