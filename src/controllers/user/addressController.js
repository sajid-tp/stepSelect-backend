// src/controllers/user/addressController.js
const addressService = require('../../services/user/addressService');

// Helper to reliably grab user id regardless of JWT structure
const getUserId = (req) => req.user?.id || req.user?._id;

// GET /addresses - List Addresses
const getAddresses = async (req, res) => {
  try {
    const userId = getUserId(req);
    console.log('User is ',userId)
    const addresses = await addressService.getAddresses(userId);
    console.log('Address is '.addresses);
    return res.status(200).json({ success: true, data: addresses });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

// POST /addresses - Create New Address
const createAddress = async (req, res) => {
  try {
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
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 3 || trimmedName.length > 25) {
      return res.status(400).json({ success: false, message: 'Name must be between 3 and 25 characters' });
    }

    const allowedTypes = ['Home', 'Work', 'Other'];
    if (addressType && !allowedTypes.includes(addressType)) {
      return res.status(400).json({ success: false, message: 'Address type must be Home, Work, or Other' });
    }

    const trimmedAddress = detailedAddress.trim();
    if (trimmedAddress.length < 10 || trimmedAddress.length > 200) {
      return res.status(400).json({ success: false, message: 'Detailed address must be between 10 and 200 characters' });
    }

    const countryRegex = /^[A-Za-z\s]{2,56}$/;
    if (!countryRegex.test(country.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid country name' });
    }

    const cityRegex = /^[A-Za-z\s]{2,56}$/;
    if (!cityRegex.test(city.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid city name' });
    }

    const pinCodeRegex = /^\d{4,10}$/;
    if (!pinCodeRegex.test(String(pinCode).trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid pin code' });
    }

    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(String(phoneNumber).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must contain only digits and be at least 10 digits long',
      });
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email' });
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

    return res.status(201).json({ success: true, data: newAddress });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

// PATCH /addresses/:id - Update Address
const updateAddress = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    const updatedAddress = await addressService.updateAddress(userId, id, req.body);
    return res.status(200).json({ success: true, data: updatedAddress });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

// DELETE /addresses/:id - Delete Address
const deleteAddress = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await addressService.deleteAddress(userId, id);
    return res.status(200).json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};