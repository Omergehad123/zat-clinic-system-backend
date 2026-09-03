const express = require('express');
const router = express.Router();
const { getUsers, createUser, updateUser, deleteUser } = require('../controllers/user.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize, branchIsolation } = require('../middleware/role.middleware');

router.use(protect);
router.use(branchIsolation);

router.get('/', authorize('super_admin', 'branch_manager'), getUsers);
router.post('/', authorize('super_admin', 'branch_manager'), createUser);
router.put('/:id', authorize('super_admin', 'branch_manager'), updateUser);
router.delete('/:id', authorize('super_admin'), deleteUser);

module.exports = router;
