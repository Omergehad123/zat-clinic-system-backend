const express = require('express');
const router = express.Router();
const { getAttendance, recordAttendance } = require('../controllers/attendance.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getAttendance);
router.post('/', recordAttendance);

module.exports = router;
