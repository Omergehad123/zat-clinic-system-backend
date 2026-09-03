const express = require('express');
const router = express.Router();
const { getExpenses, createExpense } = require('../controllers/expense.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getExpenses);
router.post('/', createExpense);

module.exports = router;
