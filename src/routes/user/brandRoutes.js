const express = require('express');

const router = express.Router();

const {
  getBrands,
} = require('../../controllers/user/brandController');


router.get('/', getBrands);


module.exports = router;