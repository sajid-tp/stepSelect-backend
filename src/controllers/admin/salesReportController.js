// src/controllers/admin/salesReportController.js
const salesReportService = require('../../services/admin/adminSalesReportServices');
const { writePdf, buildExcel } = require('../../services/admin/salesReportExport');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');

/*
  GET /api/admin/sales-report?period=daily|weekly|monthly|yearly|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&search=&page=&limit=
  GET /api/admin/sales-report/export?format=pdf|excel&period=...&from=&to=&search=
*/

const getSalesReport = async (req, res) => {
  const { period, from, to, search, page, limit } = req.query;
  const data = await salesReportService.getReport({ period, from, to, search, page, limit });
  return res.status(STATUS.OK).json({ data });
};

const exportSalesReport = async (req, res) => {
  const { format, period, from, to, search } = req.query;
  if (!['pdf', 'excel'].includes(format)) {
    throw createError('Format must be pdf or excel.', STATUS.BAD_REQUEST);
  }

  const data = await salesReportService.getExportData({ period, from, to, search });
  const name = `sales-report-${data.range.from}${data.range.from === data.range.to ? '' : `_to_${data.range.to}`}`;

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    return writePdf(res, data);
  }

  const file = buildExcel(data);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  return res.status(STATUS.OK).send(file);
};

module.exports = { getSalesReport, exportSalesReport };
