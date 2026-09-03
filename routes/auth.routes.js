const express = require('express');
const router = express.Router();
const { login, getMe, resetPassword } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/reset-password', protect, resetPassword);

module.exports = router;
