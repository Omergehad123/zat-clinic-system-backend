const EmployeeAdvance = require('../models/EmployeeAdvance');
const Employee = require('../models/Employee');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

// GET /api/advances
const getAdvances = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };

    if (req.query.employeeId) {
      filter.employeeId = req.query.employeeId;
    }

    if (req.query.date) {
      const startOfDay = new Date(req.query.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(req.query.date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    } else if (req.query.month && req.query.year) {
      const m = parseInt(req.query.month) - 1;
      const y = parseInt(req.query.year);
      const startOfMonth = new Date(y, m, 1);
      const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const advances = await EmployeeAdvance.find(filter)
      .populate('employeeId', 'name role specialization')
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    let totalAmount = 0;
    const roleTotals = { doctor: 0, nurse: 0, supervisor: 0, worker: 0 };

    const formatted = advances.map(a => {
      const amt = a.amount || 0;
      totalAmount += amt;
      const role = a.employeeId ? a.employeeId.role : null;
      if (role && roleTotals[role] !== undefined) {
        roleTotals[role] += amt;
      }

      const roleToAr = { doctor: 'دكتور', nurse: 'تمريض', supervisor: 'مشرف', worker: 'عامل' };
      const employeeType = role ? (roleToAr[role] || role) : '-';

      return {
        id: a._id.toString(),
        _id: a._id.toString(),
        employeeId: a.employeeId ? (a.employeeId._id || a.employeeId).toString() : null,
        employeeName: a.employeeId ? a.employeeId.name : '',
        role: role || '',
        employeeType,
        branchId: a.branchId ? (a.branchId._id || a.branchId).toString() : null,
        branchName: a.branchId ? a.branchId.name : 'الفرع الرئيسي',
        amount: a.amount,
        date: a.date,
        notes: a.notes,
        createdBy: a.createdBy ? a.createdBy.name : ''
      };
    });

    res.json({
      success: true,
      count: formatted.length,
      totalAmount,
      roleTotals,
      data: formatted
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/advances
const createAdvance = async (req, res, next) => {
  try {
    const { employeeId, amount, date, notes } = req.body;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    }

    if (req.user.role !== 'super_admin' && employee.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإضافة سلفة لموظف في فرع آخر' });
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ السلفة يجب أن يكون أكبر من الصفر' });
    }

    const advance = await EmployeeAdvance.create({
      employeeId: employee._id,
      branchId: employee.branchId,
      amount: numAmount,
      date: date || Date.now(),
      notes: notes || '',
      createdBy: req.user._id
    });

    // Auto-create expense transaction for employee advance
    await Transaction.create({
      type: 'expense',
      amount: numAmount,
      date: advance.date,
      category: 'Employee Advances',
      description: `سلفة موظف - ${employee.name} (${employee.role})`,
      branchId: employee.branchId,
      employeeId: employee._id,
      createdBy: req.user._id
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_EMPLOYEE_ADVANCE',
      entity: 'EmployeeAdvance',
      entityId: advance._id,
      branchId: employee.branchId,
      metadata: { employeeId: employee._id, amount: numAmount }
    });

    res.status(201).json({
      success: true,
      data: {
        id: advance._id.toString(),
        _id: advance._id.toString(),
        employeeId: advance.employeeId.toString(),
        employeeName: employee.name,
        branchId: advance.branchId.toString(),
        amount: advance.amount,
        date: advance.date,
        notes: advance.notes
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAdvances, createAdvance };
