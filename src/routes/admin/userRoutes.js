const express = require("express");
const router = express.Router();
const {adminProtect} = require('../../middleware/authMiddleware')

const { getUsers, toggleUserStatus } = require('../../controllers/admin/userController');

router.get('/',adminProtect, getUsers);
router.patch('/:userId/status', adminProtect, toggleUserStatus);

module.exports = router;