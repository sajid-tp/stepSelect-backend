const express = require("express");

const router = express.Router();

const {
  uploadProductImages,
} = require(
  "../../controllers/admin/uploadContoller"
);

// const {
//   protect,
// } = require(
//   "../../middleware/authMiddleware"
// );

const {
  upload,
} = require(
  "../../middleware/uploadMiddleware"
);


// =====================================================
// UPLOAD PRODUCT IMAGES
// =====================================================

router.post(
  "/product-images",
  upload.array("images", 10),
  uploadProductImages
);


module.exports = router;