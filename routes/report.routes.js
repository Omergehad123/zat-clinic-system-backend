const express = require('express');
const router = express.Router();
const { getMonthlyReport, getBranchComparison, exportExcel } = require('../controllers/report.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/monthly', getMonthlyReport);
router.get('/comparison', getBranchComparison);
router.get('/excel', exportExcel);

module.exports = router;
