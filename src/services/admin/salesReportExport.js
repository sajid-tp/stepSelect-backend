// src/services/admin/salesReportExport.js
// Builds the downloadable sales report: a PDF (pdfkit, like the invoice) and an Excel file.
const PDFDocument = require('pdfkit');
const { buildXlsx } = require('../../utils/xlsxWriter');

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
const dateTimeText = (d) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const periodText = (range) => (range.from === range.to ? range.from : `${range.from} to ${range.to}`);

const STATUS_TEXT = {
  pending: 'Pending',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/* ---------------------------- PDF ---------------------------- */
const writePdf = (res, data) => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.pipe(res);

  const left = 36;
  const right = doc.page.width - 36; // 806
  const bottom = doc.page.height - 50;

  // Header
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#f4511e').text('STEP SELECT', left, 36);
  doc.font('Helvetica').fontSize(10).fillColor('#555').text('Sales Report', left, 60);
  doc.fillColor('#000').fontSize(10);
  doc.text(`Period: ${data.range.label} (${periodText(data.range)})`, left, 38, { align: 'right', width: right - left });
  doc.text(`Generated: ${dateTimeText(new Date())}`, left, 52, { align: 'right', width: right - left });
  doc.moveTo(left, 78).lineTo(right, 78).strokeColor('#e5e5e5').stroke();

  // Summary cards
  const s = data.summary;
  const cards = [
    ['Total revenue', money(s.revenue)],
    ['Total orders', String(s.orders)],
    ['Avg. order value', money(s.averageOrderValue)],
    ['Total discount', money(s.totalDiscount)],
  ];
  const cardWidth = (right - left - 3 * 12) / 4;
  cards.forEach(([label, value], i) => {
    const x = left + i * (cardWidth + 12);
    doc.roundedRect(x, 90, cardWidth, 48, 5).lineWidth(0.7).strokeColor('#e5e5e5').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#777').text(label.toUpperCase(), x + 10, 98);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text(value, x + 10, 114, { width: cardWidth - 20 });
  });

  // Discount breakdown (one line)
  doc.font('Helvetica').fontSize(9).fillColor('#333');
  doc.text(
    `Gross sales ${money(s.gross)}   |   Offer discount ${money(s.offerDiscount)}   |   ` +
      `Coupon deduction ${money(s.couponDiscount)} (${s.couponOrders} orders)   |   Referral offer ${money(s.referralDiscount)}`,
    left,
    150,
    { width: right - left }
  );

  // Table
  const cols = [
    { key: 'date', title: 'Date', x: 36, w: 62 },
    { key: 'order', title: 'Order', x: 98, w: 112 },
    { key: 'customer', title: 'Customer', x: 210, w: 110 },
    { key: 'items', title: 'Items', x: 320, w: 32, align: 'right' },
    { key: 'gross', title: 'Gross', x: 356, w: 70, align: 'right' },
    { key: 'offer', title: 'Offer disc.', x: 430, w: 66, align: 'right' },
    { key: 'coupon', title: 'Coupon', x: 500, w: 66, align: 'right' },
    { key: 'referral', title: 'Referral', x: 570, w: 56, align: 'right' },
    { key: 'net', title: 'Order amount', x: 630, w: 76, align: 'right' },
    { key: 'status', title: 'Payment / Status', x: 712, w: 94 },
  ];

  const drawHead = (y) => {
    doc.rect(left, y - 4, right - left, 18).fill('#f4511e');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    cols.forEach((c) => doc.text(c.title, c.x + 2, y, { width: c.w - 4, align: c.align || 'left', lineBreak: false }));
    return y + 20;
  };

  let y = drawHead(176);
  doc.font('Helvetica').fontSize(8).fillColor('#111');

  if (data.rows.length === 0) {
    doc.fillColor('#777').text('No sales in this period.', left + 2, y + 6);
  }

  data.rows.forEach((r, i) => {
    if (y > bottom - 10) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 36 });
      y = drawHead(40);
      doc.font('Helvetica').fontSize(8);
    }
    if (i % 2 === 1) doc.rect(left, y - 3, right - left, 16).fill('#faf7f5');
    doc.fillColor('#111');
    const coupon = r.couponDiscount > 0 ? money(r.couponDiscount) : '-';
    const cells = {
      date: dateText(r.createdAt),
      order: r.orderNumber,
      customer: r.customer,
      items: String(r.itemCount),
      gross: money(r.gross),
      offer: r.offerDiscount > 0 ? money(r.offerDiscount) : '-',
      coupon,
      referral: r.referralDiscount > 0 ? money(r.referralDiscount) : '-',
      net: money(r.totalAmount),
      status: `${r.paymentMethod} / ${STATUS_TEXT[r.status] || r.status}`,
    };
    cols.forEach((c) =>
      doc.text(cells[c.key], c.x + 2, y, { width: c.w - 4, align: c.align || 'left', lineBreak: false, ellipsis: true })
    );
    y += 16;
  });

  if (data.truncated) {
    doc.fillColor('#b45309').fontSize(8).text('Only the most recent orders are listed. Narrow the date range for the full list.', left, y + 8);
  }

  doc.end();
};

/* --------------------------- Excel --------------------------- */
const buildExcel = (data) => {
  const s = data.summary;

  const summaryRows = [
    [{ v: 'STEP SELECT - Sales Report', s: 'title' }],
    [{ v: 'Period', s: 'bold' }, `${data.range.label} (${periodText(data.range)})`],
    [{ v: 'Generated', s: 'bold' }, dateTimeText(new Date())],
    [],
    [{ v: 'Summary', s: 'header' }, { v: 'Amount (INR)', s: 'header' }],
    ['Total orders', { v: s.orders, s: 'int' }],
    ['Gross sales (before discounts)', { v: s.gross, s: 'money' }],
    ['Offer discount', { v: s.offerDiscount, s: 'money' }],
    [`Coupon deduction (${s.couponOrders} orders)`, { v: s.couponDiscount, s: 'money' }],
    ['Referral offer discount', { v: s.referralDiscount, s: 'money' }],
    [{ v: 'Total discount', s: 'bold' }, { v: s.totalDiscount, s: 'money' }],
    ['Order amount (before refunds)', { v: s.grossRevenue, s: 'money' }],
    [`Refunds for returns (${s.returnedOrders} orders)`, { v: s.refunds, s: 'money' }],
    [{ v: 'Total revenue (net of refunds)', s: 'bold' }, { v: s.revenue, s: 'money' }],
    ['Average order value', { v: s.averageOrderValue, s: 'money' }],
  ];

  if (data.coupons.length) {
    summaryRows.push([], [{ v: 'Coupon', s: 'header' }, { v: 'Orders', s: 'header' }, { v: 'Deducted (INR)', s: 'header' }]);
    data.coupons.forEach((c) => summaryRows.push([c.code, { v: c.orders, s: 'int' }, { v: c.amount, s: 'money' }]));
  }
  if (data.categories.length) {
    summaryRows.push([], [{ v: 'Category', s: 'header' }, { v: 'Sales (INR)', s: 'header' }, { v: 'Share %', s: 'header' }]);
    data.categories.forEach((c) => summaryRows.push([c.name, { v: c.amount, s: 'money' }, { v: c.percent, s: 'money' }]));
  }

  const headers = [
    'Order date',
    'Order number',
    'Customer',
    'Email',
    'Items',
    'Gross (INR)',
    'Offer discount',
    'Coupon code',
    'Coupon deduction',
    'Referral discount',
    'Total discount',
    'Order amount',
    'Payment method',
    'Payment status',
    'Order status',
  ].map((v) => ({ v, s: 'header' }));

  const orderRows = [
    headers,
    ...data.rows.map((r) => [
      dateTimeText(r.createdAt),
      r.orderNumber,
      r.customer,
      r.email,
      { v: r.itemCount, s: 'int' },
      { v: r.gross, s: 'money' },
      { v: r.offerDiscount, s: 'money' },
      r.couponCode,
      { v: r.couponDiscount, s: 'money' },
      { v: r.referralDiscount, s: 'money' },
      { v: r.totalDiscount, s: 'money' },
      { v: r.totalAmount, s: 'money' },
      r.paymentMethod,
      r.paymentStatus,
      STATUS_TEXT[r.status] || r.status,
    ]),
  ];

  const trendRows = [
    [{ v: 'Period', s: 'header' }, { v: 'Orders', s: 'header' }, { v: 'Revenue (INR)', s: 'header' }],
    ...data.series.map((p) => [p.label, { v: p.orders, s: 'int' }, { v: p.revenue, s: 'money' }]),
  ];

  return buildXlsx({
    sheets: [
      { name: 'Summary', widths: [34, 30, 16], rows: summaryRows },
      { name: 'Orders', widths: [20, 24, 20, 28, 8, 14, 14, 14, 16, 16, 14, 14, 14, 14, 16], rows: orderRows },
      { name: 'Sales by period', widths: [16, 10, 16], rows: trendRows },
    ],
  });
};

module.exports = { writePdf, buildExcel };
