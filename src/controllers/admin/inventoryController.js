const inventoryService = require('../../services/admin/adminInventoryServices');
const STATUS = require('../../constants/statusCodes');
const MESSAGES = require('../../constants/messages');

// Get inventory
const getInventory = async (req, res) => {
  const { search, stockFilter, sort, page, limit } = req.query;
  const data = await inventoryService.getInventory({ search, stockFilter, sort, page, limit });
  return res.status(STATUS.OK).json({ data });
};

// Update stock
const updateStock = async (req, res) => {
  const { size, stock, adjust } = req.body || {};
  const data = await inventoryService.updateStock(req.params.variantId, { size, stock, adjust });
  return res.status(STATUS.OK).json({ message: MESSAGES.INVENTORY.STOCK_UPDATED, data });
};

module.exports = { getInventory, updateStock };
