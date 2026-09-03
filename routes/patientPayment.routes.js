const express = require('express');
const router = express.Router();
const { getPatientPayments, createPatientPayment } = require('../controllers/patientPayment.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getPatientPayments);
router.post('/', createPatientPayment);

module.exports = router;
