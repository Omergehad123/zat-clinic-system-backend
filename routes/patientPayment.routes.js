const express = require('express');
const router = express.Router();
const { getPatientPayments, createPatientPayment, deletePatientPayment } = require('../controllers/patientPayment.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation, authorize } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getPatientPayments);
router.post('/', createPatientPayment);
router.delete('/:id', authorize('super_admin'), deletePatientPayment);

module.exports = router;
