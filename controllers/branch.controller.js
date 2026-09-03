const Branch = require('../models/Branch');
const User = require('../models/User');
const { logAudit } = require('../utils/audit.utils');

// GET /api/branches
const getBranches = async (req, res, next) => {
  try {
    let query = {};
    if (req.user.role !== 'super_admin') {
      query._id = req.user.branchId;
    }
    const branches = await Branch.find(query).sort({ createdAt: -1 });

    const formatted = await Promise.all(
      branches.map(async b => {
        const manager = await User.findOne({ branchId: b._id, role: 'branch_manager' }).select('name email phone');
        return {
          id: b._id.toString(),
          _id: b._id.toString(),
          name: b.name,
          address: b.address,
          phone: b.phone,
          status: b.status,
          createdAt: b.createdAt,
          manager: manager
            ? {
                id: manager._id.toString(),
                name: manager.name,
                email: manager.email,
                phone: manager.phone
              }
            : null,
          managerName: manager ? manager.name : 'لا يوجد مدير'
        };
      })
    );

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// GET /api/branches/:id
const getBranchById = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.branchId?.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بالوصول لبيانات فرع آخر' });
    }

    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      return res.status(404).json({ success: false, message: 'الفرع غير موجود' });
    }

    const managers = await User.find({ branchId: branch._id, role: 'branch_manager' }).select('-password');

    res.json({
      success: true,
      data: {
        id: branch._id.toString(),
        _id: branch._id.toString(),
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        status: branch.status,
        createdAt: branch.createdAt,
        managers
      }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/branches
const createBranch = async (req, res, next) => {
  try {
    const { name, address, phone, managerName, managerEmail, managerPassword } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'اسم الفرع مطلوب' });
    }

    const branch = await Branch.create({
      name,
      address: address || '',
      phone: phone || '',
      status: 'active'
    });

    let managerUser = null;
    if (managerEmail && managerPassword) {
      const existingUser = await User.findOne({ email: managerEmail.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'البريد الإلكتروني لمدير الفرع مستخدم بالفعل' });
      }

      managerUser = await User.create({
        name: managerName || `مدير ${name}`,
        email: managerEmail.toLowerCase(),
        password: managerPassword,
        role: 'branch_manager',
        branchId: branch._id,
        status: 'active'
      });
    }

    await logAudit({
      user: req.user,
      action: 'CREATE_BRANCH',
      entity: 'Branch',
      entityId: branch._id,
      metadata: { branchName: branch.name, createdManager: managerUser ? managerUser.email : null }
    });

    res.status(201).json({
      success: true,
      data: {
        id: branch._id.toString(),
        _id: branch._id.toString(),
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        status: branch.status,
        manager: managerUser
          ? {
              id: managerUser._id.toString(),
              name: managerUser.name,
              email: managerUser.email
            }
          : null
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/branches/:id
const updateBranch = async (req, res, next) => {
  try {
    const { name, address, phone, status } = req.body;
    const branch = await Branch.findById(req.params.id);

    if (!branch) {
      return res.status(404).json({ success: false, message: 'الفرع غير موجود' });
    }

    if (name) branch.name = name;
    if (address !== undefined) branch.address = address;
    if (phone !== undefined) branch.phone = phone;
    if (status) branch.status = status;

    await branch.save();

    await logAudit({
      user: req.user,
      action: 'UPDATE_BRANCH',
      entity: 'Branch',
      entityId: branch._id,
      metadata: { status: branch.status }
    });

    res.json({
      success: true,
      data: {
        id: branch._id.toString(),
        _id: branch._id.toString(),
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        status: branch.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/branches/:id (Deactivate branch)
const deactivateBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      return res.status(404).json({ success: false, message: 'الفرع غير موجود' });
    }

    branch.status = 'inactive';
    await branch.save();

    await logAudit({
      user: req.user,
      action: 'DEACTIVATE_BRANCH',
      entity: 'Branch',
      entityId: branch._id
    });

    res.json({ success: true, message: 'تم تعطيل الفرع بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getBranches, getBranchById, createBranch, updateBranch, deactivateBranch };
