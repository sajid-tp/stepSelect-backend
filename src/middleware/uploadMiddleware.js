const multer = require('multer');
const createError = require('../utils/createError');
const STATUS = require('../constants/statusCodes');
const MESSAGES = require('../constants/messages');
const ERROR_CODES = require('../constants/errorCodes');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(createError(MESSAGES.UPLOAD.ONLY_IMAGE_FILES_ARE_ALLOWED, STATUS.BAD_REQUEST, ERROR_CODES.INVALID_FILE_TYPE), false);
    }
  },
});

const PROFILE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
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
