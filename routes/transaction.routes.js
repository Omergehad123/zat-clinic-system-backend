const express = require('express');
const router = express.Router();
const { getTransactions } = require('../controllers/transaction.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getTransactions);

module.exports = router;
