// src/services/admin/adminSalesReportServices.js
// Everything the admin "Sales Report" page needs: totals, discounts, a trend line,
// sales by category and the list of orders. The export (PDF / Excel) uses the same data.
//
// What counts as a sale: an order that is not cancelled and (for online payments) was really paid.
// This is the same rule the admin orders list uses to hide unpaid online orders.
//
// Returns: a returned order STAYS in the order count (the sale really happened), but the money
// refunded for it is taken off the revenue. Refunds are taken off on the day the refund was given
// (the wallet entry of the approved return), so the numbers of past days never change later.
// Cancelled orders are not counted at all; they are only reported as a separate number.
const Order = require('../../models/order');
const OrderItem = require('../../models/orderItem');
const Product = require('../../models/products');
const Category = require('../../models/categories');
const User = require('../../models/user');
const WalletTransaction = require('../../models/walletTransaction');
const createError = require('../../utils/createError');
const STATUS = require('../../constants/statusCodes');
const { ORDER_STATUS, ITEM_STATUS, unpaidOnlineFilter } = require('../../constants/orderConstants');
const { WALLET_SOURCE } = require('../../constants/walletConstants');
const { escapeRegex } = require('../../utils/orderHelpers');

/* ------------------------------------------------------------------ */
/* Dates. Report days are calendar days in India (IST, UTC+05:30, no daylight saving),
   so "Today" means the same thing no matter where the server runs.                    */
/* ------------------------------------------------------------------ */
const REPORT_TIMEZONE = 'Asia/Kolkata';
const OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 1100; // about 3 years
const EXPORT_ROW_LIMIT = 20000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const PERIODS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
const PERIOD_LABELS = {
  daily: 'Today',
  weekly: 'Last 7 days',
  monthly: 'Last 30 days',
  yearly: 'This year',
  custom: 'Custom range',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A Date moved by the IST offset, so the UTC getters read as IST wall-clock time
const toIst = (date) => new Date(date.getTime() + OFFSET_MINUTES * 60000);
const ymd = (date) => toIst(date).toISOString().slice(0, 10);

// "2026-10-30" -> the real instant that IST day starts
const dayStart = (ymdText) => new Date(new Date(`${ymdText}T00:00:00.000Z`).getTime() - OFFSET_MINUTES * 60000);

const isYmd = (text) => /^\d{4}-\d{2}-\d{2}$/.test(String(text || '')) && !isNaN(new Date(`${text}T00:00:00.000Z`));

// Turns { period, from, to } into [start, end) plus the matching "previous period" of the same length
const resolveRange = ({ period, from, to } = {}) => {
  const chosen = period || 'daily';
  if (!PERIODS.includes(chosen)) {
    throw createError('Period must be daily, weekly, monthly, yearly or custom.', STATUS.BAD_REQUEST);
  }

  const todayText = ymd(new Date());
  const tomorrowStart = new Date(dayStart(todayText).getTime() + DAY_MS);
  let start;
  let end = tomorrowStart;

  if (chosen === 'daily') {
    start = dayStart(todayText);
  } else if (chosen === 'weekly') {
    start = new Date(tomorrowStart.getTime() - 7 * DAY_MS);
  } else if (chosen === 'monthly') {
    start = new Date(tomorrowStart.getTime() - 30 * DAY_MS);
  } else if (chosen === 'yearly') {
    start = dayStart(`${todayText.slice(0, 4)}-01-01`);
  } else {
    if (!isYmd(from) || !isYmd(to)) {
      throw createError('Please choose both a start date and an end date.', STATUS.BAD_REQUEST);
    }
    start = dayStart(from);
    end = new Date(dayStart(to).getTime() + DAY_MS);
    if (end <= start) {
      throw createError('The end date cannot be before the start date.', STATUS.BAD_REQUEST);
    }
    if ((end - start) / DAY_MS > MAX_CUSTOM_DAYS) {
      throw createError('Please choose a range of 3 years or less.', STATUS.BAD_REQUEST);
    }
  }

  const length = end - start;
  const days = Math.round(length / DAY_MS);
  const unit = days <= 1 ? 'hour' : days <= 92 ? 'day' : 'month';

  return {
    period: chosen,
    label: PERIOD_LABELS[chosen],
    start,
    end,
    prevStart: new Date(start.getTime() - length),
    prevEnd: start,
    from: ymd(start),
    to: ymd(new Date(end.getTime() - 1)),
    days,
    unit,
  };
};

/* ------------------------------------------------------------------ */
/* Buckets for the "Sales over time" line                              */
/* ------------------------------------------------------------------ */
const pad = (n) => String(n).padStart(2, '0');
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

// All bucket keys + labels between start and end (in IST)
const buildBuckets = (start, end, unit) => {
  const buckets = [];
  if (unit === 'hour') {
    const day = ymd(start);
    for (let h = 0; h < 24; h += 1) buckets.push({ key: `${day} ${pad(h)}`, label: hourLabel(h) });
    return buckets;
  }
  if (unit === 'day') {
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
      const d = toIst(new Date(t));
      buckets.push({
        key: d.toISOString().slice(0, 10),
        label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      });
    }
    return buckets;
  }
  const first = toIst(start);
  const last = toIst(new Date(end.getTime() - 1));
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  while (year < last.getUTCFullYear() || (year === last.getUTCFullYear() && month <= last.getUTCMonth())) {
    buckets.push({
      key: `${year}-${pad(month + 1)}`,
      label: `${MONTHS[month]} ${String(year).slice(2)}`,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return buckets;
};

const BUCKET_FORMAT = { hour: '%Y-%m-%d %H', day: '%Y-%m-%d', month: '%Y-%m' };

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */
// Orders that count as sales in [start, end)
const salesMatch = (start, end) => ({
  createdAt: { $gte: start, $lt: end },
  status: { $ne: ORDER_STATUS.CANCELLED },
  $nor: [unpaidOnlineFilter()],
});

// Money given back for approved returns in [start, end) (wallet entries, amounts are in paise)
const returnRefundMatch = (start, end) => ({
  source: WALLET_SOURCE.ORDER_RETURN_REFUND,
  balanceAfterPaise: { $ne: null }, // a half-finished row never counts
  createdAt: { $gte: start, $lt: end },
});

const getTotals = async (start, end) => {
  const [[row], [refundRow], cancelledOrders] = await Promise.all([
    Order.aggregate([
      { $match: salesMatch(start, end) },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          gross: { $sum: '$subtotal' },
          offerDiscount: { $sum: '$discountTotal' },
          couponDiscount: { $sum: '$couponDiscount' },
          referralDiscount: { $sum: '$referralDiscount' },
          revenue: { $sum: '$totalAmount' },
          couponOrders: { $sum: { $cond: [{ $gt: ['$couponDiscount', 0] }, 1, 0] } },
        },
      },
    ]),
    WalletTransaction.aggregate([
      { $match: returnRefundMatch(start, end) },
      { $group: { _id: null, paise: { $sum: '$amountPaise' }, orderIds: { $addToSet: '$orderId' } } },
    ]),
    // Cancelled orders (by the day they were placed). Unpaid online orders were never real orders.
    Order.countDocuments({
      createdAt: { $gte: start, $lt: end },
      status: ORDER_STATUS.CANCELLED,
      $nor: [unpaidOnlineFilter()],
    }),
  ]);

  const t = row || {};
  const totalDiscount = (t.offerDiscount || 0) + (t.couponDiscount || 0) + (t.referralDiscount || 0);

  const refunds = round2((refundRow ? refundRow.paise : 0) / 100);
  const returnedOrders = refundRow ? refundRow.orderIds.filter(Boolean).length : 0;
  const grossRevenue = round2(t.revenue);
  const revenue = round2(grossRevenue - refunds); // net revenue: what the shop really kept

  return {
    orders: t.orders || 0,
    gross: round2(t.gross),
    offerDiscount: round2(t.offerDiscount),
    couponDiscount: round2(t.couponDiscount),
    referralDiscount: round2(t.referralDiscount),
    totalDiscount: round2(totalDiscount),
    grossRevenue, // order amounts before the refunds for returns
    refunds, // money refunded for returned items in this period
    revenue, // net revenue = grossRevenue - refunds
    couponOrders: t.couponOrders || 0,
    returnedOrders, // orders that had a return refunded in this period (they stay in `orders`)
    cancelledOrders, // orders cancelled that were placed in this period (not in `orders`)
    averageOrderValue: t.orders ? Math.max(0, round2(revenue / t.orders)) : 0,
  };
};

const getSeries = async (start, end, unit, buckets) => {
  const bucketOf = (field) => ({ $dateToString: { format: BUCKET_FORMAT[unit], date: field, timezone: REPORT_TIMEZONE } });
  const [rows, refundRows] = await Promise.all([
    Order.aggregate([
      { $match: salesMatch(start, end) },
      {
        $group: {
          _id: bucketOf('$createdAt'),
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
    ]),
    // refunds for returns are taken off in the bucket of the day the refund was given
    WalletTransaction.aggregate([
      { $match: returnRefundMatch(start, end) },
      { $group: { _id: bucketOf('$createdAt'), paise: { $sum: '$amountPaise' } } },
    ]),
  ]);
  const byKey = new Map(rows.map((r) => [r._id, r]));
  const refundByKey = new Map(refundRows.map((r) => [r._id, r.paise / 100]));
  return buckets.map((b) => {
    const r = byKey.get(b.key);
    const refund = refundByKey.get(b.key) || 0;
    return { orders: r ? r.orders : 0, revenue: round2((r ? r.revenue : 0) - refund) };
  });
};

const getCouponUsage = async (start, end) => {
  const rows = await Order.aggregate([
    { $match: { ...salesMatch(start, end), couponDiscount: { $gt: 0 } } },
    {
      $group: {
        _id: { $ifNull: ['$couponCode', 'Coupon'] },
        orders: { $sum: 1 },
        amount: { $sum: '$couponDiscount' },
      },
    },
    { $sort: { amount: -1 } },
    { $limit: 5 },
  ]);
  return rows.map((r) => ({ code: r._id, orders: r.orders, amount: round2(r.amount) }));
};

// Sales by category: each item's money after offers and its share of coupon / referral discounts,
// minus any units cancelled. (Returns are not taken off here.)
const getCategorySales = async (start, end) => {
  const orderIds = await Order.distinct('_id', salesMatch(start, end));
  if (orderIds.length === 0) return [];

  const rows = await OrderItem.aggregate([
    { $match: { orderId: { $in: orderIds }, status: { $ne: ITEM_STATUS.CANCELLED } } },
    {
      $project: {
        productId: 1,
        net: {
          $multiply: [
            { $subtract: ['$itemTotal', { $add: [{ $ifNull: ['$couponShare', 0] }, { $ifNull: ['$referralShare', 0] }] }] },
            {
              $divide: [
                { $subtract: ['$quantity', { $ifNull: ['$cancelledQuantity', 0] }] },
                { $max: ['$quantity', 1] },
              ],
            },
          ],
        },
      },
    },
    { $lookup: { from: Product.collection.name, localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$product.categoryId', amount: { $sum: '$net' } } },
    { $lookup: { from: Category.collection.name, localField: '_id', foreignField: '_id', as: 'category' } },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    { $project: { amount: 1, name: { $ifNull: ['$category.categoryName', 'Uncategorized'] } } },
    { $sort: { amount: -1 } },
  ]);

  const positive = rows.filter((r) => r.amount > 0);
  const total = positive.reduce((sum, r) => sum + r.amount, 0);
  if (total <= 0) return [];

  // Show the top 4 categories and put the rest together as "Others"
  const top = positive.slice(0, 4);
  const rest = positive.slice(4).reduce((sum, r) => sum + r.amount, 0);
  const list = top.map((r) => ({ name: r.name, amount: round2(r.amount) }));
  if (rest > 0) list.push({ name: 'Others', amount: round2(rest) });

  return list.map((c) => ({ ...c, percent: Math.round((c.amount / total) * 1000) / 10 }));
};

// Rows for the table (and for the exports)
const toRow = (order, itemCount) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  createdAt: order.createdAt,
  customer: order.userId ? order.userId.username : 'Deleted user',
  email: order.userId ? order.userId.email : '',
  itemCount: itemCount || 0,
  gross: round2(order.subtotal),
  offerDiscount: round2(order.discountTotal),
  couponCode: order.couponCode || '',
  couponDiscount: round2(order.couponDiscount),
  referralDiscount: round2(order.referralDiscount),
  totalDiscount: round2((order.discountTotal || 0) + (order.couponDiscount || 0) + (order.referralDiscount || 0)),
  totalAmount: round2(order.totalAmount),
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  status: order.status,
});

const withItemCounts = async (orders) => {
  const counts = await OrderItem.aggregate([
    { $match: { orderId: { $in: orders.map((o) => o._id) } } },
    { $group: { _id: '$orderId', count: { $sum: '$quantity' } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  return orders.map((o) => toRow(o, byId.get(String(o._id))));
};

const searchFilter = async (search) => {
  const text = search ? String(search).trim() : '';
  if (!text) return {};
  const regex = new RegExp(escapeRegex(text), 'i');
  const users = await User.find({ $or: [{ username: regex }, { email: regex }] }).select('_id');
  return { $or: [{ orderNumber: regex }, { userId: { $in: users.map((u) => u._id) } }] };
};

// % change against the previous period. null = nothing to compare with.
const percentChange = (current, previous) => {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

/* ------------------------------------------------------------------ */
/* 1. The report (page)                                                */
/* ------------------------------------------------------------------ */
const getReport = async ({ period, from, to, search, page, limit } = {}) => {
  const range = resolveRange({ period, from, to });
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const buckets = buildBuckets(range.start, range.end, range.unit);
  const prevBuckets = buildBuckets(range.prevStart, range.prevEnd, range.unit);

  const listFilter = { ...salesMatch(range.start, range.end), ...(await searchFilter(search)) };

  const [totals, previous, series, prevSeries, coupons, categories, totalItems, orders] = await Promise.all([
    getTotals(range.start, range.end),
    getTotals(range.prevStart, range.prevEnd),
    getSeries(range.start, range.end, range.unit, buckets),
    getSeries(range.prevStart, range.prevEnd, range.unit, prevBuckets),
    getCouponUsage(range.start, range.end),
    getCategorySales(range.start, range.end),
    Order.countDocuments(listFilter),
    Order.find(listFilter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('userId', 'username email'),
  ]);

  return {
    range: {
      period: range.period,
      label: range.label,
      from: range.from,
      to: range.to,
      unit: range.unit,
    },
    summary: {
      ...totals,
      changes: {
        revenue: percentChange(totals.revenue, previous.revenue),
        orders: percentChange(totals.orders, previous.orders),
        averageOrderValue: percentChange(totals.averageOrderValue, previous.averageOrderValue),
        totalDiscount: percentChange(totals.totalDiscount, previous.totalDiscount),
      },
    },
    trend: {
      labels: buckets.map((b) => b.label),
      revenue: series.map((s) => s.revenue),
      orders: series.map((s) => s.orders),
      // the previous period lined up bucket by bucket (dashed line)
      previousRevenue: buckets.map((_, i) => (prevSeries[i] ? prevSeries[i].revenue : 0)),
    },
    categories,
    discounts: {
      offer: totals.offerDiscount,
      coupon: totals.couponDiscount,
      referral: totals.referralDiscount,
      total: totals.totalDiscount,
      couponOrders: totals.couponOrders,
      coupons,
    },
    orders: await withItemCounts(orders),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
    },
  };
};

/* ------------------------------------------------------------------ */
/* 2. Everything for a download (PDF / Excel): all orders, no paging   */
/* ------------------------------------------------------------------ */
const getExportData = async ({ period, from, to, search } = {}) => {
  const range = resolveRange({ period, from, to });
  const buckets = buildBuckets(range.start, range.end, range.unit);
  const filter = { ...salesMatch(range.start, range.end), ...(await searchFilter(search)) };

  const [totals, series, coupons, categories, orders] = await Promise.all([
    getTotals(range.start, range.end),
    getSeries(range.start, range.end, range.unit, buckets),
    getCouponUsage(range.start, range.end),
    getCategorySales(range.start, range.end),
    Order.find(filter).sort({ createdAt: -1 }).limit(EXPORT_ROW_LIMIT).populate('userId', 'username email'),
  ]);

  return {
    range: { period: range.period, label: range.label, from: range.from, to: range.to, unit: range.unit },
    summary: totals,
    series: buckets.map((b, i) => ({ label: b.label, orders: series[i].orders, revenue: series[i].revenue })),
    categories,
    coupons,
    rows: await withItemCounts(orders),
    truncated: orders.length >= EXPORT_ROW_LIMIT,
  };
};

module.exports = {
  getReport,
  getExportData,
  resolveRange,
  PERIODS,
  // shared with the dashboard
  buildBuckets,
  getSeries,
  getTotals,
  salesMatch,
  round2,
  percentChange,
};
