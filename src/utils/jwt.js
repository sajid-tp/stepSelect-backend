// src/utils/jwt.js
const jwt = require('jsonwebtoken');

// 1. Generate Tokens
const generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET, {
    expiresIn: '15m',
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const generateResetToken = (userId) => {
  return jwt.sign(
    { id: userId, purpose: 'reset' },
    process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
};

// Admin Token Generator
const generateAdminToken = () => {
  return jwt.sign({ isAdmin: true }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// 2. Verify Tokens
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET);
};

const verifyResetToken = (token) => {
  const payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET);
  if (payload.purpose !== 'reset') {
    const error = new Error('Invalid reset token');
    error.statusCode = 400;
    throw error;
  }
  return payload;
};

// 3. Cookie Management
const sendTokenCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (accessToken) {
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
  }

  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
};

// Admin Cookie Setter (matches your adminProtect cookie read: req.cookies.token)
const sendAdminTokenCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

const clearTokenCookies = (res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  };

  res.clearCookie('accessToken', { ...cookieOptions, path: '/' });
  res.clearCookie('refreshToken', { ...cookieOptions, path: '/api/auth/refresh' });
  res.clearCookie('token', { ...cookieOptions, path: '/' });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateResetToken,
  generateAdminToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyResetToken,
  sendTokenCookies,
  sendAdminTokenCookie,
  clearTokenCookies,
};