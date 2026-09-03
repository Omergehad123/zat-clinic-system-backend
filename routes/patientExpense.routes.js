const express = require('express');
const router = express.Router();
const { getPatientExpenses, createPatientExpense } = require('../controllers/patientExpense.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getPatientExpenses);
router.post('/', createPatientExpense);

module.exports = router;
