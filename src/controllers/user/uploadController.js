// src/controllers/user/uploadController.js
const uploadService = require('../../services/user/uploadService');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// 1. Upload single image
const uploadImage = async (req, res) => {
  if (!req.file) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.UPLOAD.NO_FILE_UPLOADED });
  }

  const url = await uploadService.uploadSingle(req.file, 'stepSelect');
  return res.status(STATUS.OK).json({ url });
};

// 2. Upload multiple images
const uploadMultipleImages = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(STATUS.BAD_REQUEST).json({ message: MESSAGES.UPLOAD.NO_FILES_UPLOADED });
  }

  const urls = await uploadService.uploadMultiple(req.files, 'stepSelect');
  return res.status(STATUS.OK).json({ urls });
};

module.exports = {
  uploadImage,
  uploadMultipleImages,
};