// src/services/user/invoiceService.js
// Builds the invoice PDF with pdfkit and streams it into the response.
const PDFDocument = require('pdfkit');

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;

// The invoice can be downloaded as soon as the order is placed, so it shows the CURRENT status
const STATUS_LABEL = {
  pending: 'Processing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
  return_rejected: 'Return rejected',
};
const statusLabel = (status) => STATUS_LABEL[status] || String(status || '').replace(/_/g, ' ');

const paymentLine = (order) => {
  if (order.paymentMethod === 'COD') {
    return order.paymentStatus === 'paid' ? 'Cash on delivery (paid)' : 'Cash on delivery (pay on delivery)';
  }
  return `${order.paymentMethod} (${order.paymentStatus})`;
};

const writeInvoice = (res, { order, items }) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  // Header
  doc.fontSize(22).font('Helvetica-Bold').text('STEP SELECT', { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#555').text('Tax Invoice', { align: 'left' });
  doc.moveUp(2);
  doc.fontSize(10).fillColor('#000').text(`Invoice for order: ${order.orderNumber}`, { align: 'right' });
  doc.text(`Order date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, { align: 'right' });
  doc.text(`Order status: ${statusLabel(order.status)}`, { align: 'right' });
  doc.text(`Payment: ${paymentLine(order)}`, { align: 'right' });
  doc.text(`Invoice generated: ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' });
  doc.moveDown(2);

  // Ship to
  const a = order.shippingAddress;
  doc.font('Helvetica-Bold').fontSize(11).text('Ship to');
  doc.font('Helvetica').fontSize(10);
  doc.text(a.name);
  doc.text(a.detailedAddress);
  doc.text(`${a.city}, ${a.country} - ${a.pinCode}`);
  doc.text(`Phone: ${a.phoneNumber}`);
  doc.moveDown(1.5);

  // Table header
  const col = { name: 50, size: 225, qty: 262, price: 295, status: 365, total: 460 };
  let y = doc.y;
  doc.rect(50, y - 4, 495, 20).fill('#f1f1f1');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Product', col.name + 4, y);
  doc.text('Size', col.size, y);
  doc.text('Qty', col.qty, y);
  doc.text('Price', col.price, y);
  doc.text('Status', col.status, y);
  doc.text('Total', col.total, y);
  y += 24;

  // Rows
  doc.font('Helvetica').fontSize(10);
  for (const item of items) {
    if (y > 720) {
      doc.addPage();
      y = 60;
    }
    const label = item.color ? `${item.name} (${item.color})` : item.name;
    doc.text(label, col.name + 4, y, { width: 165 });
    const rowHeight = doc.heightOfString(label, { width: 165 });
    doc.text(String(item.size), col.size, y);
    doc.text(String(item.quantity), col.qty, y);
    doc.text(money(item.finalPrice), col.price, y, { width: 65 });
    doc.fontSize(9).text(statusLabel(item.status), col.status, y, { width: 90 });
    doc.fontSize(10).text(money(item.itemTotal), col.total, y);
    y += Math.max(rowHeight, 14) + 8;
  }

  doc.moveTo(50, y).lineTo(545, y).strokeColor('#ccc').stroke();
  y += 12;

  // Totals
  const row = (label, value, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#000');
    doc.text(label, 330, y);
    doc.text(value, 460, y);
    y += bold ? 20 : 16;
  };
  row('Subtotal', money(order.subtotal));
  if (order.discountTotal > 0) row('Discount', `- ${money(order.discountTotal)}`);
  if (order.couponDiscount > 0) row(order.couponCode ? `Coupon (${order.couponCode})` : 'Coupon', `- ${money(order.couponDiscount)}`);
  if (order.referralDiscount > 0) row('Referral offer', `- ${money(order.referralDiscount)}`);
  if (order.taxTotal > 0) row('Tax', money(order.taxTotal));
  row('Shipping', order.shippingFee > 0 ? money(order.shippingFee) : 'Free');
  row('Total', money(order.totalAmount), true);

  if (order.status === 'cancelled') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c');
    doc.text(
      'This order was cancelled. Any amount already paid is refunded to your wallet.',
      50,
      y + 10,
      { align: 'left', width: 495 }
    );
  }

  doc.fontSize(9).fillColor('#777').font('Helvetica');
  doc.text('Status and amounts are as of the invoice date shown above.', 50, 755, { align: 'center', width: 495 });
  doc.text('Thank you for shopping with Step Select.', 50, 770, { align: 'center', width: 495 });

  doc.end();
};

module.exports = { writeInvoice };
