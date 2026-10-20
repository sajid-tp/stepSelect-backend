// src/services/user/invoiceService.js
// Builds the invoice PDF with pdfkit and streams it into the response.
const PDFDocument = require('pdfkit');

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;

const writeInvoice = (res, { order, items }) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  // Header
  doc.fontSize(22).font('Helvetica-Bold').text('STEP SELECT', { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#555').text('Tax Invoice', { align: 'left' });
  doc.moveUp(2);
  doc.fontSize(10).fillColor('#000').text(`Invoice for order: ${order.orderNumber}`, { align: 'right' });
  doc.text(`Order date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, { align: 'right' });
  doc.text(`Payment: ${order.paymentMethod} (${order.paymentStatus})`, { align: 'right' });
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
  const col = { name: 50, size: 280, qty: 330, price: 370, total: 460 };
  let y = doc.y;
  doc.rect(50, y - 4, 495, 20).fill('#f1f1f1');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Product', col.name + 4, y);
  doc.text('Size', col.size, y);
  doc.text('Qty', col.qty, y);
  doc.text('Price', col.price, y);
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
    doc.text(label, col.name + 4, y, { width: 220 });
    const rowHeight = doc.heightOfString(label, { width: 220 });
    doc.text(String(item.size), col.size, y);
    doc.text(String(item.quantity), col.qty, y);
    doc.text(money(item.finalPrice), col.price, y);
    doc.text(money(item.itemTotal), col.total, y);
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
  if (order.taxTotal > 0) row('Tax', money(order.taxTotal));
  row('Shipping', order.shippingFee > 0 ? money(order.shippingFee) : 'Free');
  row('Total', money(order.totalAmount), true);

  doc.fontSize(9).fillColor('#777').font('Helvetica');
  doc.text('Thank you for shopping with Step Select.', 50, 770, { align: 'center', width: 495 });

  doc.end();
};

module.exports = { writeInvoice };
