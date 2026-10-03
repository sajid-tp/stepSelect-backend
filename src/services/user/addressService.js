// src/services/addressService.js
const Address = require('../../models/address');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// 1. Get all addresses for a user
const getAddresses = async (userId) => {
  return await Address.find({ user: userId }).sort({ createdAt: -1 });
};

// 2. Create Address
const createAddress = async (userId, addressData) => {
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
  } = addressData;

  // Check if user already has any address; if none, make this first one default
  const existingCount = await Address.countDocuments({ user: userId });
  const shouldBeDefault = existingCount === 0 ? true : Boolean(isDefault);

  if (shouldBeDefault) {
    await Address.updateMany({ user: userId }, { $set: { isDefault: false } });
  }

  const newAddress = await Address.create({
    user: userId,
    name,
    addressType: addressType || 'Home',
    detailedAddress,
    country,
    city,
    pinCode,
    phoneNumber,
    email,
    isDefault: shouldBeDefault,
  });

  return newAddress;
};

// 3. Update Address
const updateAddress = async (userId, addressId, updateData) => {
  const address = await Address.findOne({ _id: addressId, user: userId });
  if (!address) {
    throw createError('Address Not Found', 404);
  }

  // If making this one default, unset all others
  if (updateData.isDefault) {
    await Address.updateMany(
      { user: userId, _id: { $ne: addressId } },
      { $set: { isDefault: false } }
    );
  }

  // Strip forbidden fields from update object
  const { user, _id, ...safeUpdates } = updateData;

  const updatedAddress = await Address.findByIdAndUpdate(
    addressId,
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  return updatedAddress;
};

// 4. Delete Address
const deleteAddress = async (userId, addressId) => {
  const address = await Address.findOneAndDelete({ _id: addressId, user: userId });
  if (!address) {
    throw createError('Address Not Found', 404);
  }

  // If deleted address was default, set the latest remaining address to default
  if (address.isDefault) {
    const nextDefault = await Address.findOne({ user: userId }).sort({ createdAt: -1 });
    if (nextDefault) {
      nextDefault.isDefault = true;
      await nextDefault.save();
    }
  }

  return true;
};

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};