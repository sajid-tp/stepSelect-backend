// src/services/uploadService.js
const cloudinary = require('../../config/cloudinary');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Helper: convert Multer buffer to base64 data URI
const bufferToDataUri = (file) => {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

// 1. Upload a single file
const uploadSingle = async (file, folder = 'stepSelect') => {
  if (!file) {
    throw createError('No file provided', 400);
  }

  const fileStr = bufferToDataUri(file);
  const result = await cloudinary.uploader.upload(fileStr, { folder });

  return result.secure_url;
};

// 2. Upload multiple files in parallel
const uploadMultiple = async (files, folder = 'stepSelect') => {
  if (!files || files.length === 0) {
    throw createError('No files provided', 400);
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