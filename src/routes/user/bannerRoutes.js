const express = require('express');
const { getPublicBanners } = require('../../controllers/admin/bannerController');

const router = express.Router();

// Public: the landing page reads the banners the admin has switched on
router.get('/', getPublicBanners);

module.exports = router;
