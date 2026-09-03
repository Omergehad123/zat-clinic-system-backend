const Transaction = require('../models/Transaction');
const PatientPayment = require('../models/PatientPayment');
const Patient = require('../models/Patient');
const EmployeeAdvance = require('../models/EmployeeAdvance');
const Employee = require('../models/Employee');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');

// GET /api/transactions
const getTransactions = async (req, res, next) => {
  try {
    const branchFilter = { ...req.branchFilter };

    // Auto-sync any existing PatientPayments into Transactions if missing
    try {
      const payments = await PatientPayment.find(branchFilter);
      for (const p of payments) {
        const existingTx = await Transaction.findOne({
          patientId: p.patientId,
          amount: p.amount,
          date: p.date
        });
        if (!existingTx) {
          const patient = await Patient.findById(p.patientId);
          await Transaction.create({
            type: 'income',
            amount: p.amount,
            date: p.date || Date.now(),
            category: 'Accommodation',
            description: `دفعة إقامة - ${patient ? patient.name : 'نزيل'} (${p.paymentMethod || 'كاش'})`,
            branchId: p.branchId,
            patientId: p.patientId,
            createdBy: p.createdBy
          });
        }
      }

      // Auto-sync Advances
      const advances = await EmployeeAdvance.find(branchFilter);
      for (const a of advances) {
        const existingTx = await Transaction.findOne({
          employeeId: a.employeeId,
          amount: a.amount,
          date: a.date
        });
        if (!existingTx) {
          const emp = await Employee.findById(a.employeeId);
          await Transaction.create({
            type: 'expense',
            amount: a.amount,
            date: a.date || Date.now(),
            category: 'Employee Advances',
            description: `سلفة موظف - ${emp ? emp.name : 'موظف'}`,
            branchId: a.branchId,
            employeeId: a.employeeId,
            createdBy: a.createdBy
          });
        }
      }

      // Auto-sync Invoices
      const invoices = await Invoice.find(branchFilter);
      for (const inv of invoices) {
        const existingTx = await Transaction.findOne({
          invoiceId: inv._id
        });
        if (!existingTx) {
          await Transaction.create({
            type: 'expense',
            amount: inv.totalAmount,
            date: inv.date || Date.now(),
            category: inv.category || 'Supplies',
            description: `فاتورة مصروفات رقم #${inv.invoiceNumber} (${inv.category || 'مستلزمات'})`,
            branchId: inv.branchId,
            invoiceId: inv._id,
            createdBy: inv.createdBy
          });
        }
      }
    } catch (syncErr) {
      console.error('Error auto-syncing transactions:', syncErr);
    }

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
