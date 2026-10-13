const uploadService = require("../../services/user/uploadService");
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

const uploadProductImages = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(STATUS.BAD_REQUEST).json({
      message: MESSAGES.UPLOAD.NO_IMAGES_UPLOADED,
    });
  }

  const urls = await uploadService.uploadMultiple(
    req.files,
    "stepSelect/products"
  );


  return res.status(STATUS.OK).json({
    urls,
  });
};

module.exports = {
  uploadProductImages,
};