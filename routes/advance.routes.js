const express = require('express');
const router = express.Router();
const { getAdvances, createAdvance } = require('../controllers/advance.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getAdvances);
router.post('/', createAdvance);

module.exports = router;
