// middleware/uploadMiddleware.js
const multer = require('multer');
const createError = require('../utils/createError');
const STATUS = require('../constants/statusCodes');
const MESSAGES = require('../constants/messages');
const ERROR_CODES = require('../constants/errorCodes');

// Store the file in memory (as a Buffer), not on disk
const storage = multer.memoryStorage();

// General uploader (admin product images, banners) - unchanged
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(createError(MESSAGES.UPLOAD.ONLY_IMAGE_FILES_ARE_ALLOWED, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_FILE_TYPE), false);
    }
  },
});

// ---- Profile photo: same limits as the Edit Profile screen -----------------
const PROFILE_IMAGE_MAX_BYTES = 3 * 1024 * 1024; // 3MB (matches the frontend)
const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const profileImageUpload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (PROFILE_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(createError('Please select a valid image file (PNG, JPG, JPEG, WEBP).', STATUS.BAD_REQUEST, ERROR_CODES.INVALID_FILE_TYPE), false);
    }
  },
});

// Wrapped so multer errors (e.g. "file too large") become a clean 400
// instead of falling through to the generic 500 handler.
const uploadProfileImage = (req, res, next) => {
  profileImageUpload.single('profileImage')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(createError('Image must be smaller than 3MB.', STATUS.BAD_REQUEST));
    }
    return next(err.statusCode ? err : createError(err.message || 'Image upload failed.', STATUS.BAD_REQUEST));
  });
};

module.exports = { upload, uploadProfileImage };
