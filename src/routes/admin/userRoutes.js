const express = require("express");
const router = express.Router();
const {protect} = require('../../middleware/authMiddleware')

const { getUsers, toggleUserStatus } = require('../../controllers/admin/userController');

router.get('/',protect("admin"), getUsers);
router.patch('/:userId/status', protect("admin"), toggleUserStatus);

module.exports = router;