// src/services/payment/gateways/index.js
// One place that knows which payment gateways exist and which are switched on.
// A gateway is "on" when its keys are in .env. To add another gateway later:
// create a file here with { name, isConfigured, createPayment, refund } and register it below.
const { PAYMENT_METHODS } = require('../../../constants/orderConstants');
const razorpay = require('./razorpay');

const GATEWAYS = {
  [PAYMENT_METHODS.RAZORPAY]: razorpay,
};

const getGateway = (name) => GATEWAYS[String(name || '').toUpperCase()] || null;

// What the checkout page may offer: COD always, plus every configured gateway
const getEnabledMethods = () => [
  PAYMENT_METHODS.COD,
  ...Object.values(GATEWAYS).filter((g) => g.isConfigured()).map((g) => g.name),
];

module.exports = { getGateway, getEnabledMethods };
