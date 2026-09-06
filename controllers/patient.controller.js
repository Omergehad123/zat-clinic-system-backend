const Patient = require('../models/Patient');
const PatientPayment = require('../models/PatientPayment');
const PatientExpense = require('../models/PatientExpense');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

// Helper to attach calculated financial totals to patient object with UI compatibility aliases
const formatPatientWithFinancials = async (patient) => {
  const patientId = patient._id;

  const payments = await PatientPayment.find({ patientId });
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const expenses = await PatientExpense.find({ patientId });
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const accommodationAmount = Number(patient.accommodationAmount || 0);
  const remaining = Math.max(0, accommodationAmount - totalPaid);

  // صافي الإيرادات = قيمة الإقامة - مصاريف النزيل الشخصية
  const netRevenue = accommodationAmount - totalExpenses;

  // Status Arabic translation
  let statusAr = 'حالي';
  if (patient.status === 'discharged' || patient.status === 'خرج') {
    statusAr = 'خرج';
  } else if (patient.status === 'new' || patient.status === 'جديد') {
    statusAr = 'جديد';
  }

  const bId = patient.branchId ? (patient.branchId._id || patient.branchId).toString() : null;
  const bName = (patient.branchId && patient.branchId.name) ? patient.branchId.name : 'غير محدد';

  return {
    id: patient._id.toString(),
    _id: patient._id.toString(),
    name: patient.name,
    entryDate: patient.entryDate,
    exitDate: patient.exitDate,
    expectedExitDate: patient.exitDate,
    branchId: bId,
    branchName: bName,
    
    // Canonical backend fields
    accommodationAmount,
    paidAmount: totalPaid,
    remainingAmount: remaining,
    totalExpenses,

    // صافي الإيرادات (Net Revenue = accommodationAmount - totalExpenses)
    netRevenue,

    // Frontend UI aliases for complete compatibility
    stayValue: accommodationAmount,
    paid: totalPaid,
    remaining: remaining,
    expensesTotal: totalExpenses,

    notes: patient.notes || '',
    status: statusAr,
    statusEn: patient.status,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt
  };
};

// GET /api/patients
const getPatients = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    if (req.query.status && req.query.status !== 'ALL') {
      if (req.query.status === 'حالي' || req.query.status === 'current') {
        filter.status = { $in: ['current', 'حالي'] };
      } else if (req.query.status === 'خرج' || req.query.status === 'discharged') {
        filter.status = { $in: ['discharged', 'خرج'] };
      } else if (req.query.status === 'جديد' || req.query.status === 'new') {
        filter.status = { $in: ['new', 'جديد'] };
      } else {
        filter.status = req.query.status;
      }
    }

    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: 'i' };
    }

    const patients = await Patient.find(filter).populate('branchId', 'name').sort({ createdAt: -1 });

    const formattedList = await Promise.all(
      patients.map(p => formatPatientWithFinancials(p))
    );

    res.json({ success: true, count: formattedList.length, data: formattedList });
  } catch (error) {
    next(error);
  }
};

// GET /api/patients/:id
const getPatientById = async (req, res, next) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'المريض غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId && patient.branchId.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بمشاهدة مريض لفرع آخر' });
    }

    const formatted = await formatPatientWithFinancials(patient);
    const payments = await PatientPayment.find({ patientId: patient._id }).sort({ date: -1 });
    const expenses = await PatientExpense.find({ patientId: patient._id }).sort({ date: -1 });

    res.json({
      success: true,
      data: {
        ...formatted,
        payments,
        expenses
      }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/patients
const createPatient = async (req, res, next) => {
  try {
    const { 
      name, 
      entryDate, 
      exitDate, 
      expectedExitDate, 
      accommodationAmount, 
      stayValue, 
      firstPayment,
      initialExpenses,
      notes, 
      status, 
      branchId 
    } = req.body;

    const targetBranchId = req.user.role === 'super_admin' ? (branchId || req.body.branchId) : req.user.branchId;

    if (!targetBranchId) {
      return res.status(400).json({ success: false, message: 'معرف الفرع مطلوب' });
    }

    const finalAccommodation = Number(accommodationAmount ?? stayValue ?? 0);
    const finalExitDate = exitDate || expectedExitDate || null;

    const patient = await Patient.create({
      name,
      entryDate: entryDate || Date.now(),
      exitDate: finalExitDate,
      branchId: targetBranchId,
      accommodationAmount: finalAccommodation,
      notes: notes || '',
      status: status || 'current'
    });

    // Create initial payment record if firstPayment was provided
    const initialPayment = Number(firstPayment || 0);
    if (initialPayment > 0) {
      const payment = await PatientPayment.create({
        patientId: patient._id,
        branchId: targetBranchId,
        amount: initialPayment,
        date: entryDate || Date.now(),
        paymentMethod: 'كاش',
        notes: 'الدفعة الأولى عند التسجيل',
        createdBy: req.user._id
      });

      await Transaction.create({
        type: 'income',
        amount: initialPayment,
        date: payment.date,
        category: 'Accommodation',
        description: `دفعة إقامة (الدفعة الأولى) - ${patient.name}`,
        branchId: targetBranchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
    }

    // Create initial patient expense record if initialExpenses was provided
    const finalInitialExpenses = Number(initialExpenses || 0);
    if (finalInitialExpenses > 0) {
      await PatientExpense.create({
        patientId: patient._id,
        branchId: targetBranchId,
        description: 'مصاريف ابتدائية عند التسجيل',
        category: 'أخرى',
        amount: finalInitialExpenses,
        date: entryDate || Date.now(),
        notes: 'مصاريف مسجلة مسبقاً عند إنشاء ملف النزيل',
        createdBy: req.user._id
      });

      await Transaction.create({
        type: 'expense',
        amount: finalInitialExpenses,
        date: entryDate || Date.now(),
        category: 'PatientExpense',
        description: `مصاريف ابتدائية - ${patient.name}`,
        branchId: targetBranchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
    }

    await logAudit({
      user: req.user,
      action: 'CREATE_PATIENT',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId,
      metadata: { name: patient.name, accommodationAmount: patient.accommodationAmount, firstPayment: initialPayment }
    });

    const formatted = await formatPatientWithFinancials(patient);
    res.status(201).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// PUT /api/patients/:id
const updatePatient = async (req, res, next) => {
  try {
    const { name, entryDate, exitDate, expectedExitDate, accommodationAmount, stayValue, notes, status } = req.body;

    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'المريض غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId && patient.branchId.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل مريض لفرع آخر' });
    }

    if (name) patient.name = name;
    if (entryDate) patient.entryDate = entryDate;
    if (exitDate !== undefined || expectedExitDate !== undefined) patient.exitDate = exitDate || expectedExitDate;
    if (accommodationAmount !== undefined || stayValue !== undefined) {
      patient.accommodationAmount = Number(accommodationAmount ?? stayValue);
    }
    if (notes !== undefined) patient.notes = notes;
    if (status) patient.status = status;

    await patient.save();

    await logAudit({
      user: req.user,
      action: 'UPDATE_PATIENT',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId,
      metadata: { status: patient.status }
    });

    const formatted = await formatPatientWithFinancials(patient);
    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/patients/:id
const deletePatient = async (req, res, next) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'المريض غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId && patient.branchId.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بحذف مريض لفرع آخر' });
    }

    if (req.query.permanent === 'true' || req.body.permanent === true) {
      await PatientPayment.deleteMany({ patientId: patient._id });
      await PatientExpense.deleteMany({ patientId: patient._id });
      await Transaction.deleteMany({ patientId: patient._id });
      await Patient.findByIdAndDelete(patient._id);

      await logAudit({
        user: req.user,
        action: 'PERMANENT_DELETE_PATIENT',
        entity: 'Patient',
        entityId: patient._id,
        branchId: patient.branchId,
        metadata: { name: patient.name }
      });

      return res.json({ success: true, message: 'تم حذف النزيل نهائياً من النظام' });
    }

    patient.status = 'discharged';
    patient.exitDate = req.body.exitDate || new Date();
    await patient.save();

    await logAudit({
      user: req.user,
      action: 'DISCHARGE_PATIENT',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId
    });

    res.json({ success: true, message: 'تم تسريح المريض بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPatients, getPatientById, createPatient, updatePatient, deletePatient };
