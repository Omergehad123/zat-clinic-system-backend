const express = require('express');
const router = express.Router();
const { getPatientExpenses, createPatientExpense, deletePatientExpense } = require('../controllers/patientExpense.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation, authorize } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getPatientExpenses);
router.post('/', createPatientExpense);
router.delete('/:id', authorize('super_admin'), deletePatientExpense);

module.exports = router;
