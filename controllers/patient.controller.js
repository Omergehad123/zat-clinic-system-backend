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

  const timeline = patient.timeline || [];
  const renewalEvents = timeline.filter(e => e.type === 'renewal');
  let lastRenewalDate = patient.lastRenewalDate || null;
  if (!lastRenewalDate && renewalEvents.length > 0) {
    lastRenewalDate = renewalEvents[renewalEvents.length - 1].date;
  }
  if (!lastRenewalDate && patient.notes) {
    const match = patient.notes.match(/\[تجديد إقامة بتاريخ\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\]/);
    if (match && match[1]) {
      lastRenewalDate = new Date(match[1]);
    }
  }
  const renewalsCount = patient.renewalsCount || renewalEvents.length || (lastRenewalDate ? 1 : 0);

  return {
    id: patient._id.toString(),
    _id: patient._id.toString(),
    name: patient.name,
    entryDate: patient.entryDate,
    exitDate: patient.exitDate,
    expectedExitDate: patient.exitDate,
    lastRenewalDate,
    renewalDate: lastRenewalDate,
    renewalsCount,
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
    timeline,
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

    // Build or ensure timeline events
    let timeline = patient.timeline || [];
    
    // If no timeline exists (legacy patient), construct baseline events
    if (timeline.length === 0) {
      timeline = [
        {
          _id: patient._id.toString() + '_entry',
          type: 'entry',
          title: 'دخول أولي / تسجيل الحجز',
          date: patient.entryDate || patient.createdAt,
          amount: patient.accommodationAmount || 0,
          periodStart: patient.entryDate,
          periodEnd: patient.exitDate,
          details: patient.notes || 'تسجيل دخول النزيل لأول مرة'
        }
      ];

      if (patient.status === 'discharged' && patient.exitDate) {
        timeline.push({
          _id: patient._id.toString() + '_discharge',
          type: 'discharge',
          title: 'تسجيل خروج النزيل',
          date: patient.exitDate,
          details: 'تم إنهاء الإقامة وتسجيل الخروج'
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...formatted,
        timeline,
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
    const effectiveEntryDate = entryDate ? new Date(entryDate) : new Date();

    const initialTimeline = [
      {
        type: 'entry',
        title: 'دخول أولي / تسجيل الحجز',
        date: effectiveEntryDate,
        amount: finalAccommodation,
        periodStart: effectiveEntryDate,
        periodEnd: finalExitDate ? new Date(finalExitDate) : null,
        details: notes || 'تسجيل دخول النزيل لأول مرة بالفرع',
        createdBy: req.user._id
      }
    ];

    const patient = await Patient.create({
      name,
      entryDate: effectiveEntryDate,
      exitDate: finalExitDate,
      branchId: targetBranchId,
      accommodationAmount: finalAccommodation,
      notes: notes || '',
      status: status || 'current',
      timeline: initialTimeline
    });

    // Create initial payment record if firstPayment was provided
    const initialPayment = Number(firstPayment || 0);
    if (initialPayment > 0) {
      const payment = await PatientPayment.create({
        patientId: patient._id,
        branchId: targetBranchId,
        amount: initialPayment,
        date: effectiveEntryDate,
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

      patient.timeline.push({
        type: 'payment',
        title: 'الدفعة الأولى عند الحجز',
        date: effectiveEntryDate,
        amount: initialPayment,
        details: 'طريقة الدفع: كاش',
        createdBy: req.user._id
      });
      await patient.save();
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
        date: effectiveEntryDate,
        notes: 'مصاريف مسجلة مسبقاً عند إنشاء ملف النزيل',
        createdBy: req.user._id
      });

      await Transaction.create({
        type: 'expense',
        amount: finalInitialExpenses,
        date: effectiveEntryDate,
        category: 'PatientExpense',
        description: `مصاريف ابتدائية - ${patient.name}`,
        branchId: targetBranchId,
        patientId: patient._id,
        createdBy: req.user._id
      });

      patient.timeline.push({
        type: 'expense',
        title: 'مصروف ابتدائي عند التسجيل',
        date: effectiveEntryDate,
        amount: finalInitialExpenses,
        details: 'مصاريف مسجلة مسبقاً عند إنشاء ملف النزيل',
        createdBy: req.user._id
      });
      await patient.save();
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
    res.status(201).json({ success: true, data: { ...formatted, timeline: patient.timeline } });
  } catch (error) {
    next(error);
  }
};

// POST /api/patients/:id/renew
const renewPatient = async (req, res, next) => {
  try {
    const { 
      renewDate, 
      expectedExitDate, 
      accommodationAmount, 
      stayValue, 
      mode = 'add', // 'add' to accumulate, 'replace' to overwrite
      firstPayment, 
      paymentMethod = 'كاش', 
      expenseDeposit,
      notes 
    } = req.body;

    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'النزيل غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId && patient.branchId.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتجديد إقامة نزيل لفرع آخر' });
    }

    const renewValue = Number(accommodationAmount ?? stayValue ?? 0);
    const effectiveRenewDate = renewDate ? new Date(renewDate) : new Date();
    const effectiveExitDate = expectedExitDate ? new Date(expectedExitDate) : null;

    if (mode === 'replace') {
      patient.accommodationAmount = renewValue;
    } else {
      patient.accommodationAmount = Number(patient.accommodationAmount || 0) + renewValue;
    }

    patient.status = 'current';
    patient.exitDate = effectiveExitDate;
    patient.lastRenewalDate = effectiveRenewDate;
    patient.renewalsCount = (Number(patient.renewalsCount) || 0) + 1;
    if (expenseDeposit !== undefined && expenseDeposit !== '') {
      patient.expenseDeposit = Number(expenseDeposit);
    }
    
    if (notes) {
      const dateStr = effectiveRenewDate.toISOString().split('T')[0];
      patient.notes = patient.notes 
        ? `${patient.notes}\n[تجديد إقامة بتاريخ ${dateStr}]: ${notes}`
        : `[تجديد إقامة بتاريخ ${dateStr}]: ${notes}`;
    }

    if (!patient.timeline) {
      patient.timeline = [];
    }

    // Add renewal timeline entry
    patient.timeline.push({
      type: 'renewal',
      title: 'تجديد الإقامة (تمديد الحجز)',
      date: effectiveRenewDate,
      amount: renewValue,
      periodStart: effectiveRenewDate,
      periodEnd: effectiveExitDate,
      details: notes || `تم تجديد الإقامة بقيمة ${renewValue} جنيه`,
      createdBy: req.user._id
    });

    await patient.save();

    // If firstPayment is provided on renewal
    const initialPayment = Number(firstPayment || 0);
    if (initialPayment > 0) {
      const payment = await PatientPayment.create({
        patientId: patient._id,
        branchId: patient.branchId,
        amount: initialPayment,
        date: effectiveRenewDate,
        paymentMethod: paymentMethod || 'كاش',
        notes: `دفعة أولى عند تجديد الإقامة${notes ? ` - ${notes}` : ''}`,
        createdBy: req.user._id
      });

      await Transaction.create({
        type: 'income',
        amount: initialPayment,
        date: payment.date,
        category: 'Accommodation',
        description: `دفعة تجديد إقامة - ${patient.name}`,
        branchId: patient.branchId,
        patientId: patient._id,
        createdBy: req.user._id
      });

      patient.timeline.push({
        type: 'payment',
        title: 'دفعة سداد (عند التجديد)',
        date: effectiveRenewDate,
        amount: initialPayment,
        details: `طريقة الدفع: ${paymentMethod || 'كاش'}`,
        createdBy: req.user._id
      });
      await patient.save();
    }

    await logAudit({
      user: req.user,
      action: 'RENEW_PATIENT',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId,
      metadata: { 
        name: patient.name,
        renewalDate: effectiveRenewDate, 
        renewValue, 
        firstPayment: initialPayment,
        newTotalAccommodation: patient.accommodationAmount
      }
    });

    const formatted = await formatPatientWithFinancials(patient);
    res.json({
      success: true,
      message: 'تم تجديد إقامة النزيل بنجاح',
      data: {
        ...formatted,
        timeline: patient.timeline
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/patients/:id
const updatePatient = async (req, res, next) => {
  try {
    const { name, entryDate, exitDate, expectedExitDate, accommodationAmount, stayValue, notes, status, expenseDeposit } = req.body;

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
    if (expenseDeposit !== undefined) patient.expenseDeposit = Number(expenseDeposit);
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
    res.json({ success: true, data: { ...formatted, timeline: patient.timeline } });
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

    const dischargeDate = req.body.exitDate ? new Date(req.body.exitDate) : new Date();
    patient.status = 'discharged';
    patient.exitDate = dischargeDate;
    
    if (!patient.timeline) {
      patient.timeline = [];
    }

    patient.timeline.push({
      type: 'discharge',
      title: 'تسجيل خروج النزيل',
      date: dischargeDate,
      details: req.body.notes || 'تم إنهاء الإقامة وتسجيل الخروج بنجاح',
      createdBy: req.user._id
    });

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

module.exports = { getPatients, getPatientById, createPatient, renewPatient, updatePatient, deletePatient };
