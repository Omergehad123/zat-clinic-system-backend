const PatientExpense = require('../models/PatientExpense');
const Patient = require('../models/Patient');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

const deleteExpenseTransaction = async (expense) => {
  if (expense.transactionId) {
    await Transaction.findByIdAndDelete(expense.transactionId);
    return;
  }

  if (!['مصاريف ابتدائية عند التسجيل', 'مصاريف مع تجديد الإقامة'].includes(expense.description)) {
    return;
  }

  const candidates = await Transaction.find({
    patientId: expense.patientId,
    category: 'PatientExpense',
    type: 'expense',
    amount: expense.amount
  });
  const targetTime = new Date(expense.date).getTime();
  const match = candidates.reduce((best, transaction) => {
    const difference = Math.abs(new Date(transaction.date).getTime() - targetTime);
    return !best || difference < best.difference ? { transaction, difference } : best;
  }, null);
  if (match && match.difference <= 24 * 60 * 60 * 1000) {
    await Transaction.findByIdAndDelete(match.transaction._id);
  }
};

// GET /api/patient-expenses
const getPatientExpenses = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    if (req.query.patientId) {
      filter.patientId = req.query.patientId;
    }

    const expenses = await PatientExpense.find(filter)
      .populate('patientId', 'name')
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    const formatted = expenses.map(e => ({
      id: e._id.toString(),
      _id: e._id.toString(),
      patientId: e.patientId ? (e.patientId._id || e.patientId).toString() : null,
      patientName: e.patientId ? e.patientId.name : '',
      branchId: e.branchId.toString(),
      description: e.description,
      category: e.category,
      amount: e.amount,
      date: e.date,
      notes: e.notes,
      createdBy: e.createdBy ? e.createdBy.name : ''
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/patient-expenses
const createPatientExpense = async (req, res, next) => {
  try {
    const { patientId, description, category, amount, date, notes } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'المريض غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإضافة مصاريف لمريض في فرع آخر' });
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ المصروف يجب أن يكون أكبر من الصفر' });
    }

    const expense = await PatientExpense.create({
      patientId: patient._id,
      branchId: patient.branchId,
      description: description || '',
      category: category || 'Medicine',
      amount: numAmount,
      date: date || Date.now(),
      notes: notes || '',
      createdBy: req.user._id
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_PATIENT_EXPENSE',
      entity: 'PatientExpense',
      entityId: expense._id,
      branchId: patient.branchId,
      metadata: { patientId: patient._id, amount: numAmount }
    });

    res.status(201).json({
      success: true,
      data: {
        id: expense._id.toString(),
        _id: expense._id.toString(),
        patientId: expense.patientId.toString(),
        patientName: patient.name,
        branchId: expense.branchId.toString(),
        description: expense.description,
        category: expense.category,
        amount: expense.amount,
        date: expense.date,
        notes: expense.notes
      }
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/patient-expenses/:id
const deletePatientExpense = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح: حذف مصاريف النزيل متاح لمدير النظام (Super Admin) فقط'
      });
    }

    const expense = await PatientExpense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'مصروف النزيل غير موجود' });
    }

    const patient = await Patient.findById(expense.patientId);
    await deleteExpenseTransaction(expense);

    if (patient && Array.isArray(patient.timeline)) {
      const event = patient.timeline.id(expense.timelineEventId) ||
        patient.timeline.find(item =>
          item.type === 'expense' &&
          item.relatedExpenseId?.toString() === expense._id.toString()
        );
      const legacyAutoExpense = ['مصاريف ابتدائية عند التسجيل', 'مصاريف مع تجديد الإقامة'].includes(expense.description);
      const legacyEvent = !event && legacyAutoExpense
        ? patient.timeline.find(item =>
            item.type === 'expense' &&
            Number(item.amount) === Number(expense.amount) &&
            Math.abs(new Date(item.date).getTime() - new Date(expense.date).getTime()) <= 24 * 60 * 60 * 1000
          )
        : null;
      if (event || legacyEvent) {
        patient.timeline.pull((event || legacyEvent)._id);
        await patient.save();
      }
    }

    await PatientExpense.findByIdAndDelete(expense._id);

    await logAudit({
      user: req.user,
      action: 'DELETE_PATIENT_EXPENSE',
      entity: 'PatientExpense',
      entityId: expense._id,
      branchId: expense.branchId,
      metadata: {
        patientId: expense.patientId,
        patientName: patient?.name || '',
        amount: expense.amount,
        description: expense.description,
        category: expense.category
      }
    });

    res.json({ success: true, message: 'تم حذف مصروف النزيل وتحديث الحسابات' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPatientExpenses, createPatientExpense, deletePatientExpense };
