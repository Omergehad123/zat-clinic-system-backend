const PatientPayment = require('../models/PatientPayment');
const Patient = require('../models/Patient');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

// GET /api/patient-payments
const getPatientPayments = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    if (req.query.patientId) {
      filter.patientId = req.query.patientId;
    }

    const payments = await PatientPayment.find(filter)
      .populate('patientId', 'name')
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    const formatted = payments.map(p => ({
      id: p._id.toString(),
      _id: p._id.toString(),
      patientId: p.patientId ? (p.patientId._id || p.patientId).toString() : null,
      patientName: p.patientId ? p.patientId.name : '',
      branchId: p.branchId.toString(),
      amount: p.amount,
      date: p.date,
      paymentMethod: p.paymentMethod,
      notes: p.notes,
      createdBy: p.createdBy ? p.createdBy.name : ''
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/patient-payments
const createPatientPayment = async (req, res, next) => {
  try {
    const { patientId, amount, date, paymentMethod, notes } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'المريض غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بإضافة دفع لمريض في فرع آخر' });
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ الدفع يجب أن يكون أكبر من الصفر' });
    }

    const payment = await PatientPayment.create({
      patientId: patient._id,
      branchId: patient.branchId,
      amount: numAmount,
      date: date || Date.now(),
      paymentMethod: paymentMethod || 'Cash',
      notes: notes || '',
      createdBy: req.user._id
    });

    // Auto-create income transaction for accommodation income
    await Transaction.create({
      type: 'income',
      amount: numAmount,
      date: payment.date,
      category: 'Accommodation',
      description: `دفعة إقامة - ${patient.name} (${paymentMethod || 'كاش'})`,
      branchId: patient.branchId,
      patientId: patient._id,
      createdBy: req.user._id
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_PATIENT_PAYMENT',
      entity: 'PatientPayment',
      entityId: payment._id,
      branchId: patient.branchId,
      metadata: { patientId: patient._id, amount: numAmount }
    });

    res.status(201).json({
      success: true,
      data: {
        id: payment._id.toString(),
        _id: payment._id.toString(),
        patientId: payment.patientId.toString(),
        patientName: patient.name,
        branchId: payment.branchId.toString(),
        amount: payment.amount,
        date: payment.date,
        paymentMethod: payment.paymentMethod,
        notes: payment.notes
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPatientPayments, createPatientPayment };
