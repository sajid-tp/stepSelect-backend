const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { upload } = require('../../middleware/uploadMiddleware');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const {
  getBanners,
  createBanner,
  updateBanner,
  toggleBannerStatus,
  deleteBanner,
} = require('../../controllers/admin/bannerController');

const router = express.Router();

// Reads one picture from the form field "image". A too-big file (multer's own error)
// becomes a clear 400 message instead of a generic server error.
const bannerImage = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(createError('The image is too large. Please keep it under 5 MB.', STATUS.BAD_REQUEST));
    }
    return next(err.statusCode ? err : createError(err.message || 'Image upload failed.', STATUS.BAD_REQUEST));
  });

router.get('/', protect('admin'), getBanners);
router.post('/', protect('admin'), bannerImage, createBanner);
router.patch('/:bannerId/status', protect('admin'), toggleBannerStatus);
router.patch('/:bannerId', protect('admin'), bannerImage, updateBanner);
router.delete('/:bannerId', protect('admin'), deleteBanner);

module.exports = router;
