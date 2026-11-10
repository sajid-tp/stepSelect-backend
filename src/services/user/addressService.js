const Address = require('../../models/address');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// Get addresses
const getAddresses = async (userId) => {
  return await Address.find({ user: userId }).sort({ createdAt: -1 });
};

// Create address
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

// Update address
const updateAddress = async (userId, addressId, updateData) => {
  const address = await Address.findOne({ _id: addressId, user: userId });
  if (!address) {
    throw createError(MESSAGES.ADDRESS.ADDRESS_NOT_FOUND, STATUS.NOT_FOUND);
  }

  if (updateData.isDefault) {
    await Address.updateMany(
      { user: userId, _id: { $ne: addressId } },
      { $set: { isDefault: false } }
    );
  }

  const { user, _id, ...safeUpdates } = updateData;

  const updatedAddress = await Address.findByIdAndUpdate(
    addressId,
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  return updatedAddress;
};

// Delete address
const deleteAddress = async (userId, addressId) => {
  const address = await Address.findOneAndDelete({ _id: addressId, user: userId });
  if (!address) {
    throw createError(MESSAGES.ADDRESS.ADDRESS_NOT_FOUND, STATUS.NOT_FOUND);
  }

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