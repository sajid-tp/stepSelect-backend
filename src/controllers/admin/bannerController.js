// src/controllers/admin/bannerController.js
const bannerService = require('../../services/admin/adminBannerServices');
const STATUS = require('../../constants/statusCodes');

/*
  GET    /api/admin/banners?search=&status=all|active|inactive&page=&limit=
  POST   /api/admin/banners                   multipart: title, image, link?, displayOrder?, isActive?
  PATCH  /api/admin/banners/:bannerId         multipart: any of the above (image optional)
  PATCH  /api/admin/banners/:bannerId/status  body: { isActive? }  (no body = flip it)
  DELETE /api/admin/banners/:bannerId
  GET    /api/banners                         public: the visible banners for the landing page
*/

const getBanners = async (req, res) => {
  const { search, status, page, limit } = req.query;
  const data = await bannerService.getBanners({ search, status, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const createBanner = async (req, res) => {
  const data = await bannerService.createBanner(req.body, req.file);
  return res.status(STATUS.CREATED || 201).json({ message: 'Banner created successfully.', data });
};

const updateBanner = async (req, res) => {
  const data = await bannerService.updateBanner(req.params.bannerId, req.body, req.file);
  return res.status(STATUS.OK).json({ message: 'Banner updated successfully.', data });
};

const toggleBannerStatus = async (req, res) => {
  const { isActive } = req.body || {};
  const data = await bannerService.toggleBannerStatus(req.params.bannerId, isActive);
  return res.status(STATUS.OK).json({
    message: data.isActive ? 'Banner is now visible on the landing page.' : 'Banner is now hidden.',
    data,
  });
};

const deleteBanner = async (req, res) => {
  const data = await bannerService.deleteBanner(req.params.bannerId);
  return res.status(STATUS.OK).json({ message: 'Banner deleted successfully.', data });
};

const getPublicBanners = async (req, res) => {
  const data = await bannerService.getActiveBanners();
  return res.status(STATUS.OK).json({ data });
};

module.exports = { getBanners, createBanner, updateBanner, toggleBannerStatus, deleteBanner, getPublicBanners };
