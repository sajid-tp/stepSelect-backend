// src/controllers/user/addressController.js
const addressService = require('../../services/user/addressService');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// Helper to reliably grab user id regardless of JWT structure
const getUserId = (req) => req.user?.id || req.user?._id;

// GET /addresses - List Addresses
const getAddresses = async (req, res) => {
  const userId = getUserId(req);
  console.log('User is ',userId)
  const addresses = await addressService.getAddresses(userId);
  console.log('Address is '.addresses);
  return res.status(STATUS.OK).json({ success: true, data: addresses });
};

// POST /addresses - Create New Address
const createAddress = async (req, res) => {
  const userId = getUserId(req);
  const {
    name,
    addressType,
    detailedAddress,
    country,
    city,
    pinCode,
    phoneNumber,
    email,
    isDefault,
  } = req.body;

  if (!name || !detailedAddress || !country || !city || !pinCode || !phoneNumber) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.MISSING_REQUIRED_FIELDS });
  }

  const trimmedName = name.trim();
  if (trimmedName.length < 3 || trimmedName.length > 25) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.NAME_MUST_BE_BETWEEN_3_AND_25_CHARACTERS });
  }

  const allowedTypes = ['Home', 'Work', 'Other'];
  if (addressType && !allowedTypes.includes(addressType)) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.ADDRESS_TYPE_MUST_BE_HOME_WORK_OR_OTHER });
  }

  const trimmedAddress = detailedAddress.trim();
  if (trimmedAddress.length < 10 || trimmedAddress.length > 200) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.DETAILED_ADDRESS_LENGTH_INVALID });
  }

  const countryRegex = /^[A-Za-z\s]{2,56}$/;
  if (!countryRegex.test(country.trim())) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.PLEASE_ENTER_A_VALID_COUNTRY_NAME });
  }

  const cityRegex = /^[A-Za-z\s]{2,56}$/;
  if (!cityRegex.test(city.trim())) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.PLEASE_ENTER_A_VALID_CITY_NAME });
  }

  const pinCodeRegex = /^\d{4,10}$/;
  if (!pinCodeRegex.test(String(pinCode).trim())) {
    return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.ADDRESS.PLEASE_ENTER_A_VALID_PIN_CODE });
  }

  const phoneRegex = /^\d{10,15}$/;
  if (!phoneRegex.test(String(phoneNumber).trim())) {
    return res.status(STATUS.BAD_REQUEST).json({
      success: false,
      message: MESSAGES.USER.PHONE_NUMBER_INVALID,
    });
  }

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.USER.PLEASE_ENTER_A_VALID_EMAIL });
    }
  }

  const newAddress = await addressService.createAddress(userId, {
    name: trimmedName,
    addressType,
    detailedAddress: trimmedAddress,
    country: country.trim(),
    city: city.trim(),
    pinCode: String(pinCode).trim(),
    phoneNumber: String(phoneNumber).trim(),
    email,
    isDefault,
  });

  return res.status(STATUS.CREATED).json({ success: true, data: newAddress });
};

// PATCH /addresses/:id - Update Address
const updateAddress = async (req, res) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const updatedAddress = await addressService.updateAddress(userId, id, req.body);
  return res.status(STATUS.OK).json({ success: true, data: updatedAddress });
};

// DELETE /addresses/:id - Delete Address
const deleteAddress = async (req, res) => {
  const userId = getUserId(req);
  const { id } = req.params;

  await addressService.deleteAddress(userId, id);
  return res.status(STATUS.OK).json({ success: true, message: MESSAGES.ADDRESS.DELETED_SUCCESSFULLY });
};

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};