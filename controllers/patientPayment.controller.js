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
      metadata: { patientId: patient._id, amount: numAmount, patientName: patient.name }
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

// DELETE /api/patient-payments/:id
const deletePatientPayment = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Super admin role enforcement
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح: حذف دفعات سداد الإقامة متاح لمدير النظام (Super Admin) فقط'
      });
    }

    let payment = await PatientPayment.findById(id);
    let patient = null;
    let paymentAmount = 0;
    let paymentDate = null;
    let patientId = null;
    let branchId = null;

    if (payment) {
      patientId = payment.patientId;
      paymentAmount = Number(payment.amount || 0);
      paymentDate = payment.date;
      branchId = payment.branchId;

      patient = await Patient.findById(patientId);

      // 1. Delete the PatientPayment document
      await PatientPayment.findByIdAndDelete(id);

      // 2. Remove matching income Transaction
      const payTime = new Date(paymentDate).getTime();
      const txList = await Transaction.find({
        patientId,
        category: 'Accommodation',
        type: 'income',
        amount: paymentAmount
      });

      let bestTx = null;
      let minDiff = Infinity;
      for (const tx of txList) {
        const diff = Math.abs(new Date(tx.date).getTime() - payTime);
        if (diff < minDiff) {
          minDiff = diff;
          bestTx = tx;
        }
      }
      if (bestTx) {
        await Transaction.findByIdAndDelete(bestTx._id);
      }

      // 3. Remove from patient.timeline if present
      if (patient && Array.isArray(patient.timeline)) {
        const tlIndex = patient.timeline.findIndex(ev =>
          ev.type === 'payment' &&
          Number(ev.amount) === paymentAmount &&
          Math.abs(new Date(ev.date).getTime() - payTime) <= 24 * 60 * 60 * 1000
        );
        if (tlIndex !== -1) {
          patient.timeline.splice(tlIndex, 1);
          await patient.save();
        }
      }
    } else {
      // Fallback: check if id is a subdocument ID in a Patient's timeline
      patient = await Patient.findOne({ 'timeline._id': id });
      if (patient) {
        const tlEvent = patient.timeline.id(id);
        if (tlEvent) {
          patientId = patient._id;
          paymentAmount = Number(tlEvent.amount || 0);
          paymentDate = tlEvent.date;
          branchId = patient.branchId;

          const payTime = new Date(paymentDate).getTime();

          // Try to find matching PatientPayment
          const matchingPayment = await PatientPayment.findOne({
            patientId,
            amount: paymentAmount
          }).sort({ createdAt: -1 });

          if (matchingPayment) {
            await PatientPayment.findByIdAndDelete(matchingPayment._id);
          }

          // Try to delete matching transaction
          const txList = await Transaction.find({
            patientId,
            category: 'Accommodation',
            type: 'income',
            amount: paymentAmount
          });
          let bestTx = null;
          let minDiff = Infinity;
          for (const tx of txList) {
            const diff = Math.abs(new Date(tx.date).getTime() - payTime);
            if (diff < minDiff) {
              minDiff = diff;
              bestTx = tx;
            }
          }
          if (bestTx) {
            await Transaction.findByIdAndDelete(bestTx._id);
          }

          // Pull from timeline
          patient.timeline.pull(id);
          await patient.save();
        }
      } else {
        return res.status(404).json({ success: false, message: 'دفعة السداد غير موجودة' });
      }
    }

    await logAudit({
      user: req.user,
      action: 'DELETE_PATIENT_PAYMENT',
      entity: 'PatientPayment',
      entityId: id,
      branchId: branchId || (patient ? patient.branchId : null),
      metadata: {
        patientId,
        amount: paymentAmount,
        patientName: patient ? patient.name : ''
      }
    });

    res.json({
      success: true,
      message: 'تم حذف دفعة السداد بنجاح وتحديث حساب النزيل وسجل المعاملات'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPatientPayments, createPatientPayment, deletePatientPayment };
