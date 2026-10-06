const uploadService = require("../../services/user/uploadService");

const uploadProductImages = async (req, res, next) => {
  try {

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        message: "No images uploaded",
      });
    }

    const urls = await uploadService.uploadMultiple(
      req.files,
      "stepSelect/products"
    );


    return res.status(200).json({
      urls,
    });

  } catch (err) {


    next(err);
  }
};

module.exports = {
  uploadProductImages,
};