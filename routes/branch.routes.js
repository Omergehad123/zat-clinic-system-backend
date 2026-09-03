const express = require('express');
const router = express.Router();
const { getBranches, getBranchById, createBranch, updateBranch, deactivateBranch } = require('../controllers/branch.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

router.use(protect);

router.get('/', getBranches);
router.get('/:id', getBranchById);
router.post('/', authorize('super_admin'), createBranch);
router.put('/:id', authorize('super_admin'), updateBranch);
router.delete('/:id', authorize('super_admin'), deactivateBranch);

module.exports = router;
