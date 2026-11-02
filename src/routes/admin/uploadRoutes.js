
const express = require("express");
const router = express.Router();

const {
  uploadProductImages,
} = require("../../controllers/admin/uploadContoller");

const { protect } = require("../../middleware/authMiddleware");

const { upload } = require("../../middleware/uploadMiddleware");

router.post(
  "/product-images",
  protect("admin"),
  upload.array("images", 10),
  uploadProductImages
);

module.exports = router;
