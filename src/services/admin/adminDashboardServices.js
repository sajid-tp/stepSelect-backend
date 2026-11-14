// src/services/admin/adminDashboardServices.js
// Data for the admin dashboard: totals, the sales chart and the best sellers
// (products, categories, brands). It uses the same rules and the same date filters
// as the Sales Report (see adminSalesReportServices.js), so both pages always agree.
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Product = require('../../models/products');
const Category = require('../../models/categories');
const Brand = require('../../models/brands');
const User = require('../../models/user');
const { ITEM_STATUS } = require('../../constants/orderConstants');
const {
  resolveRange,
  buildBuckets,
  getSeries,
  getTotals,
  salesMatch,
  round2,
  percentChange,
} = require('./adminSalesReportServices');

const TOP_LIMIT = 10;

// Units that really stayed sold (not cancelled, not returned) and the money they brought in
// (after offers and the item's share of coupon / referral discounts).
const soldItemStages = (orderIds) => [
  { $match: { orderId: { $in: orderIds }, status: { $ne: ITEM_STATUS.CANCELLED } } },
  {
    $project: {
      productId: 1,
      name: 1,
      image: 1,
      units: {
        $max: [
          0,
          {
            $subtract: [
              '$quantity',
              { $add: [{ $ifNull: ['$cancelledQuantity', 0] }, { $ifNull: ['$returnedQuantity', 0] }] },
            ],
          },
        ],
      },
      net: {
        $subtract: ['$itemTotal', { $add: [{ $ifNull: ['$couponShare', 0] }, { $ifNull: ['$referralShare', 0] }] }],
      },
      quantity: 1,
    },
  },
  {
    $project: {
      productId: 1,
      name: 1,
      image: 1,
      units: 1,
      revenue: { $multiply: ['$net', { $divide: ['$units', { $max: ['$quantity', 1] }] }] },
    },
  },
  { $match: { units: { $gt: 0 } } },
];

const BEST_FIRST = { units: -1, revenue: -1 };

const topProducts = async (orderIds) => {
  const rows = await OrderItem.aggregate([
    ...soldItemStages(orderIds),
    {
      $group: {
        _id: '$productId',
        units: { $sum: '$units' },
        revenue: { $sum: '$revenue' },
        name: { $first: '$name' },
        image: { $first: '$image' },
      },
    },
    { $sort: BEST_FIRST },
    { $limit: TOP_LIMIT },
  ]);
  return rows.map((r) => ({ id: String(r._id), name: r.name, image: r.image || null, units: r.units, revenue: round2(r.revenue) }));
};

// Group by a field of the product (categoryId / brandId) and read the name from its own collection
const topByProductField = async (orderIds, field, Model, nameField, fallback) => {
  const rows = await OrderItem.aggregate([
    ...soldItemStages(orderIds),
    { $lookup: { from: Product.collection.name, localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    { $group: { _id: `$product.${field}`, units: { $sum: '$units' }, revenue: { $sum: '$revenue' } } },
    { $sort: BEST_FIRST },
    { $limit: TOP_LIMIT },
    { $lookup: { from: Model.collection.name, localField: '_id', foreignField: '_id', as: 'doc' } },
    { $unwind: { path: '$doc', preserveNullAndEmptyArrays: true } },
    { $project: { units: 1, revenue: 1, name: { $ifNull: [`$doc.${nameField}`, fallback] } } },
  ]);
  return rows.map((r) => ({ id: r._id ? String(r._id) : fallback, name: r.name, units: r.units, revenue: round2(r.revenue) }));
};

// Add each row's share of the biggest one, so the screen can draw bars
const withShare = (rows) => {
  const max = rows.length ? rows[0].units : 0;
  return rows.map((r) => ({ ...r, percentOfTop: max ? Math.round((r.units / max) * 100) : 0 }));
};

const getDashboard = async ({ period, from, to } = {}) => {
  const range = resolveRange({ period, from, to });
  const buckets = buildBuckets(range.start, range.end, range.unit);
  const prevBuckets = buildBuckets(range.prevStart, range.prevEnd, range.unit);

  const orderIds = await Order.distinct('_id', salesMatch(range.start, range.end));

  const [totals, previous, series, prevSeries, products, categories, brands, totalUsers, newUsers] =
    await Promise.all([
      getTotals(range.start, range.end),
      getTotals(range.prevStart, range.prevEnd),
      getSeries(range.start, range.end, range.unit, buckets),
      getSeries(range.prevStart, range.prevEnd, range.unit, prevBuckets),
      orderIds.length ? topProducts(orderIds) : [],
      orderIds.length ? topByProductField(orderIds, 'categoryId', Category, 'categoryName', 'Uncategorized') : [],
      orderIds.length ? topByProductField(orderIds, 'brandId', Brand, 'brandName', 'Unknown brand') : [],
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: range.start, $lt: range.end } }),
    ]);

  // Units sold in the period = what the best-seller queries would add up to; count them directly
  const [unitsRow] = orderIds.length
    ? await OrderItem.aggregate([...soldItemStages(orderIds), { $group: { _id: null, units: { $sum: '$units' } } }])
    : [];

  return {
    range: { period: range.period, label: range.label, from: range.from, to: range.to, unit: range.unit },
    summary: {
      revenue: totals.revenue,
      orders: totals.orders,
      returnedOrders: totals.returnedOrders,
      cancelledOrders: totals.cancelledOrders,
      refunds: totals.refunds,
      unitsSold: unitsRow ? unitsRow.units : 0,
      totalDiscount: totals.totalDiscount,
      averageOrderValue: totals.averageOrderValue,
      totalUsers,
      newUsers,
      changes: {
        revenue: percentChange(totals.revenue, previous.revenue),
        orders: percentChange(totals.orders, previous.orders),
      },
    },
    trend: {
      labels: buckets.map((b) => b.label),
      revenue: series.map((s) => s.revenue),
      orders: series.map((s) => s.orders),
      previousRevenue: buckets.map((_, i) => (prevSeries[i] ? prevSeries[i].revenue : 0)),
    },
    topProducts: withShare(products),
    topCategories: withShare(categories),
    topBrands: withShare(brands),
  };
};

module.exports = { getDashboard };
