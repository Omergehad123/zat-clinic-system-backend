const Transaction = require('../models/Transaction');

// GET /api/transactions
const getTransactions = async (req, res, next) => {
  try {
    const branchFilter = { ...req.branchFilter };

    const filter = { ...req.branchFilter };

    if (req.query.type) {
      filter.type = req.query.type;
    }
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

    const transactions = await Transaction.find(filter)
      .populate('patientId', 'name')
      .populate('employeeId', 'name role')
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    let totalIncome = 0;
    let totalExpenses = 0;

    const formatted = transactions.map(t => {
      if (t.type === 'income') {
        totalIncome += t.amount;
      } else if (t.type === 'expense') {
        totalExpenses += t.amount;
      }

      return {
        id: t._id.toString(),
        _id: t._id.toString(),
        type: t.type,
        amount: t.amount,
        date: t.date,
        category: t.category,
        description: t.description,
        branchId: t.branchId.toString(),
        patientId: t.patientId ? (t.patientId._id || t.patientId).toString() : null,
        patientName: t.patientId ? t.patientId.name : null,
        employeeId: t.employeeId ? (t.employeeId._id || t.employeeId).toString() : null,
        employeeName: t.employeeId ? t.employeeId.name : null,
        invoiceId: t.invoiceId ? t.invoiceId.toString() : null,
        createdBy: t.createdBy ? t.createdBy.name : ''
      };
    });

    const netIncome = totalIncome - totalExpenses;

    res.json({
      success: true,
      count: formatted.length,
      summary: {
        totalIncome,
        totalExpenses,
        netIncome
      },
      data: formatted
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getTransactions };
