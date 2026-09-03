const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { logAudit } = require('../utils/audit.utils');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'يرجى تقديم البريد الإلكتروني وكلمة المرور' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    let branch = null;
    if (user.role !== 'super_admin' && user.branchId) {
      branch = await Branch.findById(user.branchId);
    }

    const token = generateToken(user._id);

    await logAudit({
      user,
      action: 'LOGIN',
      entity: 'User',
      entityId: user._id,
      branchId: user.branchId,
      metadata: { email: user.email, role: user.role }
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId ? user.branchId.toString() : null,
        status: user.status
      },
      branch: branch
        ? {
            id: branch._id.toString(),
            _id: branch._id.toString(),
            name: branch.name,
            address: branch.address,
            phone: branch.phone,
            status: branch.status
          }
        : null
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    let branch = null;
    if (user.branchId) {
      branch = await Branch.findById(user.branchId);
    }

    res.json({
      success: true,
      user: {
        id: user._id.toString(),
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId ? user.branchId.toString() : null,
        status: user.status
      },
      branch
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset user password (Super Admin or Self)
// @route   POST /api/auth/reset-password
// @access  Private
const resetPassword = async (req, res, next) => {
  try {
    const { userId, newPassword } = req.body;

    let targetUserId = userId || req.user._id;

    if (req.user.role !== 'super_admin' && targetUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتغيير كلمة مرور مستخدم آخر' });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    user.password = newPassword;
    await user.save();

    await logAudit({
      user: req.user,
      action: 'RESET_PASSWORD',
      entity: 'User',
      entityId: user._id,
      branchId: user.branchId
    });

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { login, getMe, resetPassword };
