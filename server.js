require('dotenv').config();


const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const connectDB = require('./src/config/db');
const errorHandler = require('./src/middleware/errorHandler');
const notFoundMiddleware = require('./src/middleware/notFoundMiddleware');

const authRoutes = require('./src/routes/user/authRoutes');
const adminAuthRoutes = require('./src/routes/admin/authRoutes');
const adminUserRoutes = require('./src/routes/admin/userRoutes');
const accountRoutes = require('./src/routes/user/profileRoutes');
const addressRoutes = require('./src/routes/user/addressRoutes');
const productRoutes = require('./src/routes/user/productRoutes');
const categoryRoutes = require('./src/routes/user/categoryRoutes');
const brandRoutes = require('./src/routes/user/brandRoutes');
const cartRoutes = require('./src/routes/user/cartRoutes');
const wishlistRoutes = require('./src/routes/user/wishlistRoutes');
const checkoutRoutes = require('./src/routes/user/checkoutRoutes');
const orderRoutes = require('./src/routes/user/orderRoutes');
const paymentRoutes = require('./src/routes/user/paymentRoutes');
const { startSweeper } = require('./src/services/payment/unpaidOrders');
const couponRoutes = require('./src/routes/user/couponRoutes');
const adminOrderRoutes = require('./src/routes/admin/orderRoutes');
const adminInventoryRoutes = require('./src/routes/admin/inventoryRoutes');
const adminCategoryRoutes = require('./src/routes/admin/categoryRoutes');
const adminBrandRoutes = require('./src/routes/admin/brandRoutes');
const adminProducts = require('./src/routes/admin/productRoutes');
const adminVariants = require('./src/routes/admin/variantRoutes');
const adminCouponRoutes = require('./src/routes/admin/couponRoutes');
const adminUploadRoutes =
  require("./src/routes/admin/uploadRoutes");
const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));

// rawBody is kept so the Razorpay webhook signature can be checked
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

connectDB();
startSweeper(); // gives back stock held by online orders that were never paid

app.use('/api/auth', authRoutes);
app.use('/api/account',accountRoutes);
app.use('/api/addresses',addressRoutes);
app.use('/api/products',productRoutes);
app.use('/api/categories',categoryRoutes);
app.use('/api/brands',brandRoutes);
app.use('/api/cart',cartRoutes);
app.use('/api/wishlist',wishlistRoutes);
app.use('/api/checkout',checkoutRoutes);
app.use('/api/orders',orderRoutes);
app.use('/api/payments',paymentRoutes);
app.use('/api/coupons',couponRoutes);

//admin routes
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/users',adminUserRoutes);
app.use('/api/admin/categories',adminCategoryRoutes);
app.use('/api/admin/brands', adminBrandRoutes);
app.use('/api/admin/products',adminProducts);
app.use('/api/admin/variants',adminVariants);
app.use('/api/admin/coupons', adminCouponRoutes);
app.use('/api/admin/orders',adminOrderRoutes);
app.use('/api/admin/inventory',adminInventoryRoutes);
app.use(
  "/api/admin/uploads",
  adminUploadRoutes
);

app.use(notFoundMiddleware);
// Error handler: must stay LAST, after every route
app.use(errorHandler);


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});