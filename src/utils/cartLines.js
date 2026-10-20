// src/utils/cartLines.js
// Turns the cart (which only stores pointers: variantId + size + quantity) into priced lines.
// Shared by the checkout service and the coupon service so both always see the same prices.
const Variant = require('../models/variants');
const Product = require('../models/products');
const Category = require('../models/categories');
const Brand = require('../models/brands');
const { calculateLine, firstImage } = require('./orderHelpers');

const isVisible = (doc) => Boolean(doc && doc.isActive && !doc.deletedAt);

// Prices ALWAYS come from the database, never from the frontend.
// Each line has an `issue` flag (UNAVAILABLE / OUT_OF_STOCK / INSUFFICIENT_STOCK / null).
const buildLines = async (cart) => {
  if (!cart || cart.items.length === 0) return [];

  const variants = await Variant.find({ _id: { $in: cart.items.map((i) => i.variantId) } });
  const products = await Product.find({ _id: { $in: variants.map((v) => v.productId) } });
  const categories = await Category.find({ _id: { $in: products.map((p) => p.categoryId) } });
  const brands = await Brand.find({ _id: { $in: products.map((p) => p.brandId) } });

  return cart.items.map((item) => {
    const variant = variants.find((v) => String(v._id) === String(item.variantId));
    const product = variant ? products.find((p) => String(p._id) === String(variant.productId)) : null;
    const category = product ? categories.find((c) => String(c._id) === String(product.categoryId)) : null;
    const brand = product ? brands.find((b) => String(b._id) === String(product.brandId)) : null;
    const sizeEntry = variant ? variant.sizes.find((s) => String(s.size) === item.size) : null;
    const stock = sizeEntry ? sizeEntry.stock || 0 : 0;

    let issue = null;
    if (!isVisible(variant) || !isVisible(product) || !isVisible(category) || !isVisible(brand) || !sizeEntry) {
      issue = 'UNAVAILABLE';
    } else if (stock < 1) {
      issue = 'OUT_OF_STOCK';
    } else if (stock < item.quantity) {
      issue = 'INSUFFICIENT_STOCK';
    }

    const price = variant ? Number(variant.price) || 0 : 0;
    const discountPercent = variant ? Number(variant.discountPercent) || 0 : 0;
    const money = calculateLine(price, discountPercent, item.quantity);

    return {
      productId: variant ? variant.productId : null,
      variantId: item.variantId,
      name: product ? product.productName : 'Unavailable product',
      color: variant ? variant.color : '',
      size: item.size,
      image: variant ? firstImage(variant.images) : null,
      price,
      discountPercent,
      quantity: item.quantity,
      stock,
      issue,
      ...money,
    };
  });
};

module.exports = { buildLines };
