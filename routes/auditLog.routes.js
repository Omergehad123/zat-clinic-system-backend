const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLog.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getAuditLogs);

module.exports = router;
