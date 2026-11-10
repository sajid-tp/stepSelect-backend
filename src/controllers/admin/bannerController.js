const bannerService = require('../../services/admin/adminBannerServices');
const STATUS = require('../../constants/statusCodes');

// Get banners
const getBanners = async (req, res) => {
  const { search, status, page, limit } = req.query;
  const data = await bannerService.getBanners({ search, status, page, limit });
  return res.status(STATUS.OK).json({ data });
};

// Create banner
const createBanner = async (req, res) => {
  const data = await bannerService.createBanner(req.body, req.file);
  return res.status(STATUS.CREATED || 201).json({ message: 'Banner created successfully.', data });
};

// Update banner
const updateBanner = async (req, res) => {
  const data = await bannerService.updateBanner(req.params.bannerId, req.body, req.file);
  return res.status(STATUS.OK).json({ message: 'Banner updated successfully.', data });
};

// Banner status
const toggleBannerStatus = async (req, res) => {
  const { isActive } = req.body || {};
  const data = await bannerService.toggleBannerStatus(req.params.bannerId, isActive);
  return res.status(STATUS.OK).json({
    message: data.isActive ? 'Banner is now visible on the landing page.' : 'Banner is now hidden.',
    data,
  });
};

// Delete banner
const deleteBanner = async (req, res) => {
  const data = await bannerService.deleteBanner(req.params.bannerId);
  return res.status(STATUS.OK).json({ message: 'Banner deleted successfully.', data });
};

// Public banners
const getPublicBanners = async (req, res) => {
  const data = await bannerService.getActiveBanners();
  return res.status(STATUS.OK).json({ data });
};

module.exports = { getBanners, createBanner, updateBanner, toggleBannerStatus, deleteBanner, getPublicBanners };
