const User = require('../models/User');
const { logAudit } = require('../utils/audit.utils');

// GET /api/users
const getUsers = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    const users = await User.find(filter).populate('branchId', 'name').select('-password').sort({ createdAt: -1 });

    const formatted = users.map(u => ({
      id: u._id.toString(),
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
      branchId: u.branchId ? (u.branchId._id || u.branchId).toString() : null,
      branchName: u.branchId ? u.branchId.name : null,
      status: u.status,
      createdAt: u.createdAt
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/users
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, branchId } = req.body;

    let targetBranchId = req.user.role === 'super_admin' ? (branchId || null) : req.user.branchId;

    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'لا يمكن لغير الأدمن العام إنشاء حساب سوبر أدمن' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: role || 'branch_manager',
      branchId: targetBranchId,
      status: 'active'
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_USER',
      entity: 'User',
      entityId: user._id,
      branchId: user.branchId,
      metadata: { createdUserEmail: user.email, role: user.role }
    });

    res.status(201).json({
      success: true,
      data: {
        id: user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId ? user.branchId.toString() : null,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/users/:id
const updateUser = async (req, res, next) => {
  try {
    const { name, email, role, branchId, status, password } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (req.user.role !== 'super_admin' && user.branchId?.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل مستخدم لفرع آخر' });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase();
    if (role && req.user.role === 'super_admin') user.role = role;
    if (branchId !== undefined && req.user.role === 'super_admin') user.branchId = branchId;
    if (status) user.status = status;
    if (password) user.password = password;

    await user.save();

    await logAudit({
      user: req.user,
      action: 'UPDATE_USER',
      entity: 'User',
      entityId: user._id,
      branchId: user.branchId
    });

    res.json({
      success: true,
      data: {
        id: user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId ? user.branchId.toString() : null,
        status: user.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/users/:id (Deactivate)
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لغير الأدمن العام بحذف المستخدمين' });
    }

    user.status = 'inactive';
    await user.save();

    await logAudit({
      user: req.user,
      action: 'DEACTIVATE_USER',
      entity: 'User',
      entityId: user._id,
      branchId: user.branchId
    });

    res.json({ success: true, message: 'تم تعطيل حساب المستخدم بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser };
