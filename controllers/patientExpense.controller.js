const PatientExpense = require('../models/PatientExpense');
const Patient = require('../models/Patient');
const { logAudit } = require('../utils/audit.utils');

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

module.exports = { getPatientExpenses, createPatientExpense };
