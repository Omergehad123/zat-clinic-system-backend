const express = require('express');
const router = express.Router();
const { getPatients, getPatientById, createPatient, renewPatient, updatePatient, deletePatient } = require('../controllers/patient.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getPatients);
router.get('/:id', getPatientById);
router.post('/', createPatient);
router.post('/:id/renew', renewPatient);
router.put('/:id', updatePatient);
router.delete('/:id', deletePatient);

module.exports = router;
