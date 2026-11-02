// middleware/uploadMiddleware.js
const multer = require('multer');
const createError = require('../utils/createError');
const STATUS = require('../constants/statusCodes');
const MESSAGES = require('../constants/messages');
const ERROR_CODES = require('../constants/errorCodes');

// Store the file in memory (as a Buffer), not on disk
const storage = multer.memoryStorage();

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

module.exports = {upload};