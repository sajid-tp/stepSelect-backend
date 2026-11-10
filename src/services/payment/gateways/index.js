const { PAYMENT_METHODS } = require('../../../constants/orderConstants');
const razorpay = require('./razorpay');

const GATEWAYS = {
  [PAYMENT_METHODS.RAZORPAY]: razorpay,
};

const getGateway = (name) => GATEWAYS[String(name || '').toUpperCase()] || null;

const getEnabledMethods = () => [
  PAYMENT_METHODS.COD,
  ...Object.values(GATEWAYS).filter((g) => g.isConfigured()).map((g) => g.name),
];

module.exports = { getGateway, getEnabledMethods };
