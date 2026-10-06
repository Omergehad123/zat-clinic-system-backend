const express = require('express');
const router = express.Router();
const { getAdvances, createAdvance, updateAdvance, deleteAdvance } = require('../controllers/advance.controller');
const { protect } = require('../middleware/auth.middleware');
const { branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', getAdvances);
router.post('/', createAdvance);
router.put('/:id', updateAdvance);
router.delete('/:id', deleteAdvance);

module.exports = router;
