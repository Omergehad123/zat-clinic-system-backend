const Patient = require('../models/Patient');
const PatientPayment = require('../models/PatientPayment');
const PatientExpense = require('../models/PatientExpense');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

const deleteLinkedTransaction = async ({ record, patientId, amount, date, type, category }) => {
  if (record?.transactionId) {
    await Transaction.findByIdAndDelete(record.transactionId);
    return;
  }

  const candidates = await Transaction.find({ patientId, type, category, amount });
  const targetTime = new Date(date).getTime();
  const matchingTransaction = candidates.reduce((best, transaction) => {
    const difference = Math.abs(new Date(transaction.date).getTime() - targetTime);
    return !best || difference < best.difference ? { transaction, difference } : best;
  }, null);

  if (matchingTransaction && matchingTransaction.difference <= 24 * 60 * 60 * 1000) {
    await Transaction.findByIdAndDelete(matchingTransaction.transaction._id);
  }
};

const removePaymentTimelineEvent = async (patient, payment) => {
  if (!Array.isArray(patient.timeline)) return;

  let event = payment.timelineEventId
    ? patient.timeline.id(payment.timelineEventId)
    : patient.timeline.find(item => item.relatedPaymentId?.toString() === payment._id.toString());

  if (!event && /الدفعة الأولى|تجديد الإقامة/.test(payment.notes || '')) {
    event = patient.timeline.find(item =>
      item.type === 'payment' &&
      Number(item.amount) === Number(payment.amount) &&
      Math.abs(new Date(item.date).getTime() - new Date(payment.date).getTime()) <= 24 * 60 * 60 * 1000
    );
  }

  if (event) {
    patient.timeline.pull(event._id);
  }
};

// Helper to attach calculated financial totals to patient object with UI compatibility aliases
const formatPatientWithFinancials = async (patient, preloaded) => {
  const patientId = patient._id;
  const payments = preloaded?.payments || await PatientPayment.find({ patientId });
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const expenses = preloaded?.expenses || await PatientExpense.find({ patientId });
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
  const sumRenewals = renewalEvents.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const firstTrackedRenewalIndex = renewalEvents.findIndex(event => event.previousState);
  const expectedEntryAmount = firstTrackedRenewalIndex >= 0
    ? Math.max(
        0,
        Number(renewalEvents[firstTrackedRenewalIndex].previousState.accommodationAmount || 0) -
          renewalEvents.slice(0, firstTrackedRenewalIndex).reduce((sum, event) => sum + (Number(event.amount) || 0), 0)
      )
    : (renewalEvents.length > 0 ? Math.max(0, accommodationAmount - sumRenewals) : accommodationAmount);

  const normalizedTimeline = timeline.map(event => {
    if (event.type === 'entry') {
      const plain = typeof event.toObject === 'function' ? event.toObject() : { ...event };
      return {
        ...plain,
        amount: expectedEntryAmount
      };
    }
    return typeof event.toObject === 'function' ? event.toObject() : event;
  });

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
  const totalRenewalValue = renewalEvents.reduce(
    (sum, event) => sum + Number(event.amount || 0),
    0
  );
  const firstRenewalPreviousAmount = renewalEvents.length > 0
    ? Number(renewalEvents[0]?.previousState?.accommodationAmount)
    : NaN;
  const exactEntryValue = renewalEvents.length > 0
    ? (Number.isFinite(firstRenewalPreviousAmount)
        ? firstRenewalPreviousAmount
        : Math.max(0, accommodationAmount - totalRenewalValue))
    : accommodationAmount;
  const totalAccommodationValue = exactEntryValue + totalRenewalValue;

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
    totalAccommodationValue,
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
    timeline: normalizedTimeline,
    payments: payments.map(p => ({
      id: p._id.toString(),
      _id: p._id.toString(),
      amount: p.amount,
      date: p.date,
      paymentMethod: p.paymentMethod,
      notes: p.notes
    })),
    expenses: expenses.map(e => ({
      id: e._id.toString(),
      _id: e._id.toString(),
      amount: e.amount,
      date: e.date,
      category: e.category,
      description: e.description,
      notes: e.notes
    })),
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

    const patientIds = patients.map(p => p._id);
    const [allPayments, allExpenses] = await Promise.all([
      PatientPayment.find({ patientId: { $in: patientIds } }),
      PatientExpense.find({ patientId: { $in: patientIds } })
    ]);

    const paymentsByPatient = new Map();
    allPayments.forEach(payment => {
      const key = payment.patientId.toString();
      if (!paymentsByPatient.has(key)) paymentsByPatient.set(key, []);
      paymentsByPatient.get(key).push(payment);
    });

    const expensesByPatient = new Map();
    allExpenses.forEach(expense => {
      const key = expense.patientId.toString();
      if (!expensesByPatient.has(key)) expensesByPatient.set(key, []);
      expensesByPatient.get(key).push(expense);
    });

    const formattedList = await Promise.all(
      patients.map(p => formatPatientWithFinancials(p, {
        payments: paymentsByPatient.get(p._id.toString()) || [],
        expenses: expensesByPatient.get(p._id.toString()) || []
      }))
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

    // Build or ensure timeline events using normalized timeline
    let timeline = formatted.timeline || [];
    
    // If no timeline exists (legacy patient), construct baseline events
    if (timeline.length === 0) {
      timeline = [
        {
          _id: patient._id.toString() + '_entry',
          type: 'entry',
          title: 'دخول أولي / تسجيل الحجز',
          date: patient.entryDate || patient.createdAt,
          amount: formatted.accommodationAmount || 0,
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

      const transaction = await Transaction.create({
        type: 'income',
        amount: initialPayment,
        date: payment.date,
        category: 'Accommodation',
        description: `دفعة إقامة (الدفعة الأولى) - ${patient.name}`,
        branchId: targetBranchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
      payment.transactionId = transaction._id;

      patient.timeline.push({
        type: 'payment',
        title: 'الدفعة الأولى عند الحجز',
        date: effectiveEntryDate,
        amount: initialPayment,
        details: 'طريقة الدفع: كاش',
        relatedPaymentId: payment._id,
        createdBy: req.user._id
      });
      payment.timelineEventId = patient.timeline[patient.timeline.length - 1]._id;
      await payment.save();
      await patient.save();
    }

    // Create initial patient expense record if initialExpenses was provided
    const finalInitialExpenses = Number(initialExpenses || 0);
    if (finalInitialExpenses > 0) {
      const expense = await PatientExpense.create({
        patientId: patient._id,
        branchId: targetBranchId,
        description: 'مصاريف ابتدائية عند التسجيل',
        category: 'أخرى',
        amount: finalInitialExpenses,
        date: effectiveEntryDate,
        notes: 'مصاريف مسجلة مسبقاً عند إنشاء ملف النزيل',
        createdBy: req.user._id
      });

      const transaction = await Transaction.create({
        type: 'expense',
        amount: finalInitialExpenses,
        date: effectiveEntryDate,
        category: 'PatientExpense',
        description: `مصاريف ابتدائية - ${patient.name}`,
        branchId: targetBranchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
      expense.transactionId = transaction._id;

      patient.timeline.push({
        type: 'expense',
        title: 'مصروف ابتدائي عند التسجيل',
        date: effectiveEntryDate,
        amount: finalInitialExpenses,
        details: 'مصاريف مسجلة مسبقاً عند إنشاء ملف النزيل',
        relatedExpenseId: expense._id,
        createdBy: req.user._id
      });
      expense.timelineEventId = patient.timeline[patient.timeline.length - 1]._id;
      await expense.save();
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
      initialExpenses,
      expenses,
      expenseDeposit,
      notes 
    } = req.body;

    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'النزيل غير موجود' });
    }

    if (req.user.role !== 'super_admin' && patient.branchId && req.user.branchId && patient.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتجديد إقامة نزيل لفرع آخر' });
    }

    const renewValue = Number(accommodationAmount ?? stayValue ?? 0);
    const effectiveRenewDate = renewDate ? new Date(renewDate) : new Date();
    const effectiveExitDate = (expectedExitDate && String(expectedExitDate).trim() !== '') ? new Date(expectedExitDate) : null;
    const initialPayment = Number(firstPayment || 0);
    const expenseAmount = Number(initialExpenses || expenses || 0);
    const renewalMode = mode === 'replace' ? 'replace' : 'add';
    const previousState = {
      accommodationAmount: Number(patient.accommodationAmount || 0),
      exitDate: patient.exitDate,
      lastRenewalDate: patient.lastRenewalDate,
      renewalsCount: Number(patient.renewalsCount || 0),
      status: patient.status,
      expenseDeposit: Number(patient.expenseDeposit || 0),
      notes: patient.notes || ''
    };

    if (renewalMode === 'replace') {
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
    
    const noteEntry = notes
      ? `[تجديد إقامة بتاريخ ${effectiveRenewDate.toISOString().split('T')[0]}]: ${notes}`
      : '';
    if (noteEntry) {
      patient.notes = patient.notes 
        ? `${patient.notes}\n${noteEntry}`
        : noteEntry;
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
      firstPayment: initialPayment,
      initialExpenses: expenseAmount,
      details: notes || `تم تجديد الإقامة بقيمة ${renewValue} جنيه`,
      renewalMode,
      accommodationAfter: patient.accommodationAmount,
      previousState,
      noteEntry,
      createdBy: req.user._id
    });
    const renewalEvent = patient.timeline[patient.timeline.length - 1];

    await patient.save();

    // If firstPayment is provided on renewal
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

      const transaction = await Transaction.create({
        type: 'income',
        amount: initialPayment,
        date: payment.date,
        category: 'Accommodation',
        description: `دفعة تجديد إقامة - ${patient.name}`,
        branchId: patient.branchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
      payment.transactionId = transaction._id;

      patient.timeline.push({
        type: 'payment',
        title: 'دفعة سداد (عند التجديد)',
        date: effectiveRenewDate,
        amount: initialPayment,
        details: `طريقة الدفع: ${paymentMethod || 'كاش'}`,
        relatedPaymentId: payment._id,
        createdBy: req.user._id
      });
      payment.timelineEventId = patient.timeline[patient.timeline.length - 1]._id;
      renewalEvent.relatedPaymentId = payment._id;
      await payment.save();
      await patient.save();
    }

    // If initial expenses provided on renewal
    if (expenseAmount > 0) {
      const expense = await PatientExpense.create({
        patientId: patient._id,
        branchId: patient.branchId,
        description: 'مصاريف مع تجديد الإقامة',
        category: 'أخرى',
        amount: expenseAmount,
        date: effectiveRenewDate,
        notes: `مصاريف مسجلة عند تجديد الإقامة${notes ? ` - ${notes}` : ''}`,
        createdBy: req.user._id
      });

      const transaction = await Transaction.create({
        type: 'expense',
        amount: expenseAmount,
        date: effectiveRenewDate,
        category: 'PatientExpense',
        description: `مصاريف تجديد إقامة - ${patient.name}`,
        branchId: patient.branchId,
        patientId: patient._id,
        createdBy: req.user._id
      });
      expense.transactionId = transaction._id;

      patient.timeline.push({
        type: 'expense',
        title: 'مصروف عند تجديد الإقامة',
        date: effectiveRenewDate,
        amount: expenseAmount,
        details: `مصاريف مسجلة عند تجديد الإقامة`,
        relatedExpenseId: expense._id,
        createdBy: req.user._id
      });
      expense.timelineEventId = patient.timeline[patient.timeline.length - 1]._id;
      renewalEvent.relatedExpenseId = expense._id;
      await expense.save();
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
        initialExpenses: expenseAmount,
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

// DELETE /api/patients/:id/renewals/:renewalId
const deletePatientRenewal = async (req, res, next) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'النزيل غير موجود' });
    }

    const renewalEvent = patient.timeline.id(req.params.renewalId);
    if (!renewalEvent || renewalEvent.type !== 'renewal') {
      return res.status(404).json({ success: false, message: 'عملية التجديد غير موجودة' });
    }

    const previousState = renewalEvent.previousState || null;
    const renewalIndex = patient.timeline.findIndex(event => event._id.toString() === renewalEvent._id.toString());
    const laterEvents = patient.timeline.slice(renewalIndex + 1);
    const laterRenewals = laterEvents.filter(event => event.type === 'renewal');
    const hasLaterStayEvent = laterEvents.some(event => ['renewal', 'discharge'].includes(event.type));

    const payment = renewalEvent.relatedPaymentId
      ? await PatientPayment.findOne({ _id: renewalEvent.relatedPaymentId, patientId: patient._id })
      : (Number(renewalEvent.firstPayment) > 0
          ? await PatientPayment.findOne({
              patientId: patient._id,
              amount: Number(renewalEvent.firstPayment),
              date: renewalEvent.date,
              notes: { $regex: 'تجديد الإقامة' }
            })
          : null);
    const expense = renewalEvent.relatedExpenseId
      ? await PatientExpense.findOne({ _id: renewalEvent.relatedExpenseId, patientId: patient._id })
      : (Number(renewalEvent.initialExpenses) > 0
          ? await PatientExpense.findOne({
              patientId: patient._id,
              amount: Number(renewalEvent.initialExpenses),
              date: renewalEvent.date,
              description: 'مصاريف مع تجديد الإقامة'
            })
          : null);

    if (payment) {
      await deleteLinkedTransaction({
        record: payment,
        patientId: patient._id,
        amount: Number(payment.amount),
        date: payment.date,
        type: 'income',
        category: 'Accommodation'
      });
      await removePaymentTimelineEvent(patient, payment);
      await PatientPayment.findByIdAndDelete(payment._id);
    }

    if (expense) {
      await deleteLinkedTransaction({
        record: expense,
        patientId: patient._id,
        amount: Number(expense.amount),
        date: expense.date,
        type: 'expense',
        category: 'PatientExpense'
      });
      if (expense.timelineEventId) {
        patient.timeline.pull(expense.timelineEventId);
      } else if (['مصاريف ابتدائية عند التسجيل', 'مصاريف مع تجديد الإقامة'].includes(expense.description)) {
        const expenseEvent = patient.timeline.find(event =>
          event.type === 'expense' &&
          Number(event.amount) === Number(expense.amount) &&
          Math.abs(new Date(event.date).getTime() - new Date(expense.date).getTime()) <= 24 * 60 * 60 * 1000
        );
        if (expenseEvent) patient.timeline.pull(expenseEvent._id);
      }
      await PatientExpense.findByIdAndDelete(expense._id);
    }

    patient.timeline.pull(renewalEvent._id);
    const remainingRenewals = patient.timeline.filter(event => event.type === 'renewal');
    if (remainingRenewals.length === 0) {
      patient.accommodationAmount = Math.max(
        0,
        Number(previousState?.accommodationAmount ?? patient.accommodationAmount ?? 0)
      );
    } else {
      const entryEvent = patient.timeline.find(event => event.type === 'entry');
      const firstRemaining = remainingRenewals[0];
      let replayAmount = Number(
        entryEvent?.amount ??
        firstRemaining.previousState?.accommodationAmount ??
        previousState?.accommodationAmount ??
        patient.accommodationAmount ??
        0
      );
      remainingRenewals.forEach(event => {
        const renewValue = Number(event.amount || 0);
        replayAmount = event.renewalMode === 'replace'
          ? renewValue
          : replayAmount + renewValue;
      });
      patient.accommodationAmount = Math.max(0, replayAmount);
    }

    patient.renewalsCount = Math.max(0, Number(patient.renewalsCount || 0) - 1);
    patient.lastRenewalDate = remainingRenewals.length
      ? remainingRenewals[remainingRenewals.length - 1].date
      : (previousState?.lastRenewalDate || null);

    if (!hasLaterStayEvent && previousState) {
      patient.exitDate = previousState.exitDate || null;
      patient.status = previousState.status || 'current';
      patient.expenseDeposit = Number(previousState.expenseDeposit || 0);
    }
    if (renewalEvent.noteEntry) {
      patient.notes = (patient.notes || '')
        .replace(renewalEvent.noteEntry, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    } else if (!hasLaterStayEvent && previousState) {
      patient.notes = previousState.notes || '';
    }

    await patient.save();

    await logAudit({
      user: req.user,
      action: 'DELETE_PATIENT_RENEWAL',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId,
      metadata: {
        patientId: patient._id,
        patientName: patient.name,
        renewalDate: renewalEvent.date,
        amount: renewalEvent.amount,
        deletedPayment: Number(payment?.amount || 0),
        deletedExpense: Number(expense?.amount || 0)
      }
    });

    res.json({
      success: true,
      message: 'تم إلغاء التجديد وحذف الدفعات والمصاريف المرتبطة به وتحديث حساب النزيل'
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

    if (req.user.role !== 'super_admin' && patient.branchId && req.user.branchId && patient.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل مريض لفرع آخر' });
    }

    if (name) patient.name = name.trim();
    if (entryDate) {
      const parsed = new Date(entryDate);
      if (!isNaN(parsed.getTime())) {
        patient.entryDate = parsed;
      }
    }
    
    // Safely handle exitDate / expectedExitDate (empty string becomes null, avoiding Mongoose CastError)
    if (exitDate !== undefined || expectedExitDate !== undefined) {
      const chosenExit = exitDate || expectedExitDate;
      if (chosenExit && String(chosenExit).trim() !== '') {
        const parsedExit = new Date(chosenExit);
        patient.exitDate = !isNaN(parsedExit.getTime()) ? parsedExit : null;
      } else {
        patient.exitDate = null;
      }
    }

    if (accommodationAmount !== undefined || stayValue !== undefined) {
      const val = accommodationAmount ?? stayValue;
      if (val !== '' && !isNaN(Number(val))) {
        patient.accommodationAmount = Number(val);
      }
    }

    if (expenseDeposit !== undefined) {
      if (expenseDeposit !== '' && !isNaN(Number(expenseDeposit))) {
        patient.expenseDeposit = Number(expenseDeposit);
      }
    }

    if (notes !== undefined) {
      patient.notes = notes;
    }

    if (status) {
      let statusEn = status;
      if (status === 'حالي') statusEn = 'current';
      if (status === 'خرج') statusEn = 'discharged';
      if (['current', 'discharged'].includes(statusEn)) {
        patient.status = statusEn;
      }
    }

    // Keep entry event in timeline synchronized with accommodationAmount, entryDate, and exitDate
    if (!patient.timeline) {
      patient.timeline = [];
    }
    const renewalSum = patient.timeline
      .filter(e => e.type === 'renewal')
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const newEntryStay = renewalSum > 0
      ? Math.max(0, Number(patient.accommodationAmount || 0) - renewalSum)
      : Number(patient.accommodationAmount || 0);

    const entryEventIndex = patient.timeline.findIndex(e => e.type === 'entry');
    if (entryEventIndex !== -1) {
      patient.timeline[entryEventIndex].amount = newEntryStay;
      if (patient.entryDate) {
        patient.timeline[entryEventIndex].date = patient.entryDate;
        patient.timeline[entryEventIndex].periodStart = patient.entryDate;
      }
      if (patient.exitDate !== undefined) {
        patient.timeline[entryEventIndex].periodEnd = patient.exitDate;
      }
    } else {
      patient.timeline.unshift({
        type: 'entry',
        title: 'دخول أولي / تسجيل الحجز',
        date: patient.entryDate || patient.createdAt || new Date(),
        amount: newEntryStay,
        periodStart: patient.entryDate || patient.createdAt || new Date(),
        periodEnd: patient.exitDate,
        details: patient.notes || 'تسجيل دخول النزيل لأول مرة بالفرع',
        createdBy: req.user._id
      });
    }

    patient.markModified('timeline');
    await patient.save();

    await logAudit({
      user: req.user,
      action: 'UPDATE_PATIENT',
      entity: 'Patient',
      entityId: patient._id,
      branchId: patient.branchId,
      metadata: { name: patient.name, status: patient.status }
    });

    const formatted = await formatPatientWithFinancials(patient);
    res.json({ success: true, message: 'تم تعديل بيانات النزيل بنجاح', data: formatted });
  } catch (error) {
    console.error('Error in updatePatient:', error);
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

module.exports = { getPatients, getPatientById, createPatient, renewPatient, deletePatientRenewal, updatePatient, deletePatient };
