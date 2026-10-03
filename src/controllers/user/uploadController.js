// src/controllers/user/uploadController.js
const uploadService = require('../../services/user/uploadService');

// 1. Upload single image
const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const url = await uploadService.uploadSingle(req.file, 'stepSelect');
    return res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
};

// 2. Upload multiple images
const uploadMultipleImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const urls = await uploadService.uploadMultiple(req.files, 'stepSelect');
    return res.status(200).json({ urls });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadImage,
  uploadMultipleImages,
};