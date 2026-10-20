// src/controllers/admin/inventoryController.js
const inventoryService = require('../../services/admin/adminInventoryServices');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

/*
  GET   /api/admin/inventory?search=&stockFilter=low|out|in&sort=stock_asc|stock_desc|name|newest&page=&limit=
  PATCH /api/admin/inventory/:variantId/stock   body: { size, stock }  (exact number)  or  { size, adjust: +10 / -3 }
*/

const getInventory = async (req, res) => {
  const { search, stockFilter, sort, page, limit } = req.query;
  const data = await inventoryService.getInventory({ search, stockFilter, sort, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const updateStock = async (req, res) => {
  const { size, stock, adjust } = req.body || {};
  const data = await inventoryService.updateStock(req.params.variantId, { size, stock, adjust });
  return res.status(STATUS.OK).json({ message: MESSAGES.INVENTORY.STOCK_UPDATED, data });
};

module.exports = { getInventory, updateStock };
