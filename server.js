require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const connectDB = require('./src/config/db');

const authRoutes = require('./src/routes/user/authRoutes');
const adminAuthRoutes = require('./src/routes/admin/authRoutes');
const adminUserRoutes = require('./src/routes/admin/userRoutes');
const accountRoutes = require('./src/routes/user/profileRoutes');
const addressRoutes = require('./src/routes/user/addressRoutes');
const adminCategoryRoutes = require('./src/routes/admin/categoryRoutes');
const adminBrandRoutes = require('./src/routes/admin/brandRoutes');
const app = express();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

connectDB();

app.use('/api/auth', authRoutes);
app.use('/api/account',accountRoutes);
app.use('/api/addresses',addressRoutes);

//admin routes
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/users',adminUserRoutes);
app.use('/api/admin/categories',adminCategoryRoutes);
app.use('/api/admin/brands', adminBrandRoutes);


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});