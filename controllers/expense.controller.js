const Expense = require('../models/Expense');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

// GET /api/expenses
const getExpenses = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.month && req.query.year) {
      const m = parseInt(req.query.month) - 1;
      const y = parseInt(req.query.year);
      const startOfMonth = new Date(y, m, 1);
      const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const expenses = await Expense.find(filter).populate('createdBy', 'name').sort({ date: -1 });

    const formatted = expenses.map(e => ({
      id: e._id.toString(),
      _id: e._id.toString(),
      branchId: e.branchId.toString(),
      date: e.date,
      category: e.category,
      items: e.items,
      totalAmount: e.totalAmount,
      notes: e.notes,
      createdBy: e.createdBy ? e.createdBy.name : ''
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/expenses
const createExpense = async (req, res, next) => {
  try {
    const { category, items, totalAmount, date, notes, branchId } = req.body;

    const targetBranchId = req.user.role === 'super_admin' ? (branchId || req.body.branchId) : req.user.branchId;

    if (!targetBranchId) {
      return res.status(400).json({ success: false, message: 'معرف الفرع مطلوب' });
    }

    const amountNum = Number(totalAmount);
    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'إجمالي مبلغ المصروف يجب أن يكون أكبر من الصفر' });
    }

    const expense = await Expense.create({
      branchId: targetBranchId,
      date: date || Date.now(),
      category: category || 'Other',
      items: items || [],
      totalAmount: amountNum,
      notes: notes || '',
      createdBy: req.user._id
    });

    // Auto-create transaction for clinic expense
    await Transaction.create({
      type: 'expense',
      amount: amountNum,
      date: expense.date,
      category: expense.category,
      description: notes || `مصروفات عيادة - ${expense.category}`,
      branchId: targetBranchId,
      createdBy: req.user._id
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_EXPENSE',
      entity: 'Expense',
      entityId: expense._id,
      branchId: targetBranchId,
      metadata: { category: expense.category, totalAmount: amountNum }
    });

    res.status(201).json({
      success: true,
      data: {
        id: expense._id.toString(),
        _id: expense._id.toString(),
        branchId: expense.branchId.toString(),
        date: expense.date,
        category: expense.category,
        items: expense.items,
        totalAmount: expense.totalAmount,
        notes: expense.notes
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getExpenses, createExpense };
