const { parsePhoneNumberFromString } = require('libphonenumber-js/mobile');

const PHONE_COUNTRY = 'IN';

const LIMITS = Object.freeze({
  USERNAME_MIN: 3,
  USERNAME_MAX: 25,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 64,
});

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const OTP_REGEX = /^\d{6}$/;
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])/;

const VALIDATION_MESSAGES = Object.freeze({
  EMAIL_REQUIRED: 'Email is required',
  EMAIL_INVALID: 'Enter a valid email address',
  PASSWORD_REQUIRED: 'Password is required',
  PASSWORD_RULES:
    'Password must be 8 to 64 characters and include an uppercase letter, a lowercase letter, a number and a special character',
  CONFIRM_PASSWORD_REQUIRED: 'Please confirm your password',
  PASSWORDS_DO_NOT_MATCH: 'Passwords do not match',
  PHONE_INVALID: 'Enter a valid 10-digit Indian mobile number',
  PHONE_REQUIRED: 'Phone number is required',
  OTP_INVALID: 'Enter a valid 6-digit code',
  TERMS_REQUIRED: 'Please accept the Terms & Conditions to create your account',
});


const normalizeEmail = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';


const validateUsername = (value, label = 'Username') => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return `${label} is required`;
  if (v.length < LIMITS.USERNAME_MIN || v.length > LIMITS.USERNAME_MAX) {
    return `${label} must be between ${LIMITS.USERNAME_MIN} and ${LIMITS.USERNAME_MAX} characters`;
  }
  return null;
};

const validateEmail = (value) => {
  const v = normalizeEmail(value);
  if (!v) return VALIDATION_MESSAGES.EMAIL_REQUIRED;
  if (
    v.length > 254 ||
    v.indexOf('@') > 64 ||
    !EMAIL_REGEX.test(v) ||
    !v.split('@')[1].includes('.')
  ) {
    return VALIDATION_MESSAGES.EMAIL_INVALID;
  }
  return null;
};

const validatePassword = (value) => {
  if (typeof value !== 'string' || !value) return VALIDATION_MESSAGES.PASSWORD_REQUIRED;
  if (
    value.length < LIMITS.PASSWORD_MIN ||
    value.length > LIMITS.PASSWORD_MAX ||
    !PASSWORD_COMPLEXITY_REGEX.test(value)
  ) {
    return VALIDATION_MESSAGES.PASSWORD_RULES;
  }
  return null;
};

const normalizePhone = (value) => {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v) return '';
  const parsed = parsePhoneNumberFromString(v, PHONE_COUNTRY);
  if (parsed && parsed.isValid() && parsed.country === PHONE_COUNTRY) {
    return parsed.nationalNumber;
  }
  return '';
};

const validatePhone = (value) => {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v) return null;
  return normalizePhone(v) ? null : VALIDATION_MESSAGES.PHONE_INVALID;
};

const validateRequiredPhone = (value) => {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v) return VALIDATION_MESSAGES.PHONE_REQUIRED;
  return normalizePhone(v) ? null : VALIDATION_MESSAGES.PHONE_INVALID;
};

const validateOtp = (value) => {
  const v = String(value ?? '').trim();
  return OTP_REGEX.test(v) ? null : VALIDATION_MESSAGES.OTP_INVALID;
};

module.exports = {
  LIMITS,
  EMAIL_REGEX,
  OTP_REGEX,
  VALIDATION_MESSAGES,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePassword,
  normalizePhone,
  validatePhone,
  validateRequiredPhone,
  validateOtp,
};
