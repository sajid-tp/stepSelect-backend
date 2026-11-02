// src/services/uploadService.js
const cloudinary = require('../../config/cloudinary');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');


// Helper: convert Multer buffer to base64 data URI
const bufferToDataUri = (file) => {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

// 1. Upload a single file
const uploadSingle = async (file, folder = 'stepSelect') => {
  if (!file) {
    throw createError(MESSAGES.UPLOAD.NO_FILE_PROVIDED, STATUS.BAD_REQUEST);
  }

  const fileStr = bufferToDataUri(file);
  const result = await cloudinary.uploader.upload(fileStr, { folder });

  return result.secure_url;
};

// 2. Upload multiple files in parallel
const uploadMultiple = async (files, folder = 'stepSelect') => {
  if (!files || files.length === 0) {
    throw createError(MESSAGES.UPLOAD.NO_FILES_PROVIDED, STATUS.BAD_REQUEST);
  }

  const uploadPromises = files.map((file) => {
    const fileStr = bufferToDataUri(file);
    return cloudinary.uploader.upload(fileStr, { folder });
  });

  const results = await Promise.all(uploadPromises);
  return results.map((result) => result.secure_url);
};

module.exports = {
  uploadSingle,
  uploadMultiple,
};