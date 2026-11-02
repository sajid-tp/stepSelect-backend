// src/services/adminAuthServices.js
const { generateAdminToken } = require('../../utils/jwt');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');


const loginAdmin = async (email, password) => {

    const isValidEmail = email === process.env.ADMIN_EMAIL;
    const isValidPassword = password === process.env.ADMIN_PASSWORD;
         if (!isValidEmail || !isValidPassword) {
                   throw createError(MESSAGES.ADMIN.INVALID_ADMIN_CREDENTIALS, STATUS.UNAUTHORIZED);
                                                }
    const token = generateAdminToken();

        return { token };
                                              };

module.exports = {
  loginAdmin,
};