const Transaction = require('../models/Transaction');
const Patient = require('../models/Patient');
const PatientPayment = require('../models/PatientPayment');
const PatientExpense = require('../models/PatientExpense');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const EmployeeAdvance = require('../models/EmployeeAdvance');
const Invoice = require('../models/Invoice');
const Branch = require('../models/Branch');
const { generateMonthlyExcelReport } = require('../services/excel.service');

// Helper to attach calculated financial totals to patient object
const formatPatientFinancials = async (patient) => {
  const patientId = patient._id;

  const [payments, expenses] = await Promise.all([
    PatientPayment.find({ patientId }),
    PatientExpense.find({ patientId })
  ]);

  let totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  let totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  // Fallback to timeline if payments/expenses are only recorded in timeline
  if (Array.isArray(patient.timeline)) {
    patient.timeline.forEach(event => {
      if (event.type === 'payment' || event.type === 'renewal') {
        const evAmt = Number(event.amount || 0);
        if (evAmt > 0 && payments.length === 0) {
          totalPaid += evAmt;
        }
      }
      if (event.type === 'expense') {
        const evAmt = Number(event.amount || 0);
        if (evAmt > 0 && expenses.length === 0) {
          totalExpenses += evAmt;
        }
      }
    });
  }

  const accommodationAmount = Number(patient.accommodationAmount || 0);
  const remaining = Math.max(0, accommodationAmount - totalPaid);
  const netRevenue = totalPaid - totalExpenses;

  return {
    ...patient.toObject(),
    id: patient._id.toString(),
    _id: patient._id.toString(),
    accommodationAmount,
    stayValue: accommodationAmount,
    paidAmount: totalPaid,
    paid: totalPaid,
    remainingAmount: remaining,
    remaining,
    totalExpenses,
    expensesTotal: totalExpenses,
    netRevenue
  };
};

// Helper to gather metrics for a specific filter and month/year
const buildReportData = async (branchFilter, month, year) => {
  const isAllMonths = month === 'all' || month === 'ALL' || month === 0 || month === '0' || !month;
  const targetM = isAllMonths ? null : parseInt(month);
  const targetY = parseInt(year) || new Date().getFullYear();

  // Load all raw data for the branch in parallel
  const [allPatientsRaw, allInvoices, allAdvances, allTransactions, allEmployees] = await Promise.all([
    Patient.find({ ...branchFilter }),
    Invoice.find({ ...branchFilter }),
    EmployeeAdvance.find({ ...branchFilter }).populate('employeeId', 'name role'),
    Transaction.find({ ...branchFilter }),
    Employee.find({ ...branchFilter })
  ]);

  // Format all patients with their financial calculations (payments and expenses)
  const allPatients = await Promise.all(
    allPatientsRaw.map(p => formatPatientFinancials(p))
  );

  const formatDateToKey = (dateInput) => {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getMonthDateRange = (y, m) => {
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59, 999);
    return { start, end };
  };

  let currentMonthStay = 0;
  let previousMonthNet = 0;
  let totalIncome = 0;
  let totalExpenses = 0;
  let netIncome = 0;
  let activeInvoices = [];
  let activeAdvances = [];
  let activePatientExpenses = 0;
  let activeDirectOtherSum = 0;

  // Helper to calculate total stay revenue for a specific monthKey (YYYY-MM)
  const calculateStayForMonth = (patients, targetKey) => {
    let stay = 0;
    patients.forEach(patient => {
      const entryKey = formatDateToKey(patient.entryDate || patient.createdAt);
      const entryEvent = Array.isArray(patient.timeline) ? patient.timeline.find(e => e.type === 'entry') : null;
      const renewalEvents = Array.isArray(patient.timeline) ? patient.timeline.filter(e => e.type === 'renewal') : [];
      const sumRenewals = renewalEvents.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      
      const pStay = Number(patient.accommodationAmount ?? patient.stayValue ?? 0);
      const lastRenKeyCheck = formatDateToKey(patient.lastRenewalDate || patient.renewalDate);
      const hasExternalRenewal = lastRenKeyCheck && lastRenKeyCheck !== entryKey;
      const hasRenewals = renewalEvents.length > 0 || hasExternalRenewal;

      let entryStay = 0;
      if (!hasRenewals) {
        entryStay = (patient.accommodationAmount !== undefined || patient.stayValue !== undefined) ? pStay : Number(entryEvent?.amount || 0);
      } else if (sumRenewals > 0) {
        entryStay = Math.max(0, pStay - sumRenewals);
      } else {
        entryStay = pStay;
      }

      if (entryKey === targetKey) {
        stay += entryStay;
      }

      const seenRenewalMonths = new Set();
      if (Array.isArray(patient.timeline)) {
        renewalEvents.forEach((renEvent) => {
          const renKey = formatDateToKey(renEvent.date);
          if (renKey && !seenRenewalMonths.has(renKey)) {
            seenRenewalMonths.add(renKey);
            if (renKey === targetKey) {
              stay += Number(renEvent.amount || 0);
            }
          }
        });
      }

      if (lastRenKeyCheck && !seenRenewalMonths.has(lastRenKeyCheck)) {
        seenRenewalMonths.add(lastRenKeyCheck);
        if (lastRenKeyCheck === targetKey) {
          const fallbackStay = Math.max(0, (Number(patient.accommodationAmount ?? patient.stayValue ?? 0)) - entryStay);
          stay += fallbackStay;
        }
      }
    });
    return stay;
  };

  if (isAllMonths) {
    // 1. All Months aggregation
    let allStaySum = 0;
    let allPatientExpSum = 0;

    allPatients.forEach(patient => {
      const entryEvent = Array.isArray(patient.timeline) ? patient.timeline.find(e => e.type === 'entry') : null;
      const renewalEvents = Array.isArray(patient.timeline) ? patient.timeline.filter(e => e.type === 'renewal') : [];
      const sumRenewals = renewalEvents.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      
      const lastRenKey = formatDateToKey(patient.lastRenewalDate || patient.renewalDate);
      const hasExternalRenewal = lastRenKey && lastRenKey !== formatDateToKey(patient.entryDate || patient.createdAt);
      const hasRenewals = renewalEvents.length > 0 || hasExternalRenewal;
      const pStay = Number(patient.accommodationAmount ?? patient.stayValue ?? 0);

      let entryStay = 0;
      if (!hasRenewals) {
        entryStay = (patient.accommodationAmount !== undefined || patient.stayValue !== undefined) ? pStay : Number(entryEvent?.amount || 0);
      } else if (sumRenewals > 0) {
        entryStay = Math.max(0, pStay - sumRenewals);
      } else {
        entryStay = pStay;
      }
      allStaySum += entryStay;

      const seenRenewalMonths = new Set();
      if (Array.isArray(patient.timeline)) {
        renewalEvents.forEach((renEvent) => {
          const renKey = formatDateToKey(renEvent.date);
          if (renKey && !seenRenewalMonths.has(renKey)) {
            seenRenewalMonths.add(renKey);
            allStaySum += Number(renEvent.amount || 0);
          }
        });
      }

      if (lastRenKey && !seenRenewalMonths.has(lastRenKey)) {
        seenRenewalMonths.add(lastRenKey);
        const fallbackStay = Math.max(0, (Number(patient.accommodationAmount ?? patient.stayValue ?? 0)) - entryStay);
        allStaySum += fallbackStay;
      }

      allPatientExpSum += Number(patient.totalExpenses ?? patient.expensesTotal ?? 0);
    });

    const totalInvoicesSum = allInvoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
    const totalAdvancesSum = allAdvances.reduce((s, adv) => s + Number(adv.amount || 0), 0);

    let allDirectOtherSum = 0;
    allTransactions.forEach(t => {
      if (t.type === 'expense') {
        const cat = t.category || '';
        if (cat !== 'Employee Advances' && cat !== 'PatientExpense' && !cat.includes('سلف') && !cat.includes('مصاريف') && !t.invoiceId && !t.employeeId && !t.patientId) {
          allDirectOtherSum += Number(t.amount || 0);
        }
      }
    });

    currentMonthStay = allStaySum;
    previousMonthNet = 0;
    totalIncome = allStaySum;
    totalExpenses = totalInvoicesSum + totalAdvancesSum + allPatientExpSum + allDirectOtherSum;
    netIncome = totalIncome - totalExpenses;

    activeInvoices = allInvoices;
    activeAdvances = allAdvances;
    activePatientExpenses = allPatientExpSum;
    activeDirectOtherSum = allDirectOtherSum;
  } else {
    // Helper to calculate full financials for any given month/year
    const calcMonthFin = (m, y) => {
      const mKey = `${y}-${String(m).padStart(2, '0')}`;
      const { start, end } = getMonthDateRange(y, m);
      const stay = calculateStayForMonth(allPatients, mKey);

      let patExp = 0;
      allPatients.forEach(patient => {
        const entryKey = formatDateToKey(patient.entryDate || patient.createdAt);
        const lastRenKey = formatDateToKey(patient.lastRenewalDate || patient.renewalDate);
        const renewalEvents = Array.isArray(patient.timeline) ? patient.timeline.filter(e => e.type === 'renewal') : [];
        const seenRenewalMonths = new Set();
        renewalEvents.forEach(renEvent => {
          const renKey = formatDateToKey(renEvent.date);
          if (renKey) seenRenewalMonths.add(renKey);
        });

        const matchesEntry = entryKey === mKey;
        const matchesRenewal = seenRenewalMonths.has(mKey) || lastRenKey === mKey;
        if (matchesEntry || matchesRenewal) {
          patExp += Number(patient.totalExpenses ?? patient.expensesTotal ?? 0);
        }
      });

      const mInvoices = allInvoices.filter(inv => {
        if (!inv.date) return false;
        const d = new Date(inv.date);
        return d >= start && d <= end;
      });
      const invSum = mInvoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);

      const mAdvances = allAdvances.filter(adv => {
        if (!adv.date) return false;
        const d = new Date(adv.date);
        return d >= start && d <= end;
      });
      const advSum = mAdvances.reduce((s, adv) => s + Number(adv.amount || 0), 0);

      let directOther = 0;
      allTransactions.forEach(t => {
        if (t.type === 'expense' && t.date) {
          const d = new Date(t.date);
          if (d >= start && d <= end) {
            const cat = t.category || '';
            if (cat !== 'Employee Advances' && cat !== 'PatientExpense' && !cat.includes('سلف') && !cat.includes('مصاريف') && !t.invoiceId && !t.employeeId && !t.patientId) {
              directOther += Number(t.amount || 0);
            }
          }
        }
      });

      const totalExp = invSum + advSum + patExp + directOther;
      return {
        stay,
        expenses: totalExp,
        net: stay - totalExp,
        invoices: mInvoices,
        advances: mAdvances,
        patExp,
        directOther
      };
    };

    // 2. Specific Single Month calculations with rolling cumulative net
    // Collect all month keys to find earliest recorded month
    const allKeys = new Set();
    allPatients.forEach(p => {
      const ek = formatDateToKey(p.entryDate || p.createdAt);
      if (ek) allKeys.add(ek);
      const lrk = formatDateToKey(p.lastRenewalDate || p.renewalDate);
      if (lrk) allKeys.add(lrk);
      if (Array.isArray(p.timeline)) {
        p.timeline.forEach(e => {
          const dk = formatDateToKey(e.date);
          if (dk) allKeys.add(dk);
        });
      }
    });
    allInvoices.forEach(i => { const k = formatDateToKey(i.date); if (k) allKeys.add(k); });
    allAdvances.forEach(a => { const k = formatDateToKey(a.date); if (k) allKeys.add(k); });
    allTransactions.forEach(t => { const k = formatDateToKey(t.date); if (k) allKeys.add(k); });

    const validKeys = [...allKeys].filter(k => k && /^\d{4}-\d{2}$/.test(k)).sort();
    const startKey = (validKeys[0] && validKeys[0] < monthKey) ? validKeys[0] : monthKey;

    const getConsecutiveMonthKeys = (sKey, eKey) => {
      if (!sKey || !eKey) return [];
      if (sKey > eKey) return [eKey];
      const keys = [];
      let [curY, curM] = sKey.split('-').map(Number);
      const [endY, endM] = eKey.split('-').map(Number);
      while (curY < endY || (curY === endY && curM <= endM)) {
        keys.push(`${curY}-${String(curM).padStart(2, '0')}`);
        curM++;
        if (curM > 12) { curM = 1; curY++; }
      }
      return keys;
    };

    const consecutiveKeys = getConsecutiveMonthKeys(startKey, monthKey);
    let runningNet = 0;

    consecutiveKeys.forEach(k => {
      const [ky, km] = k.split('-').map(Number);
      const fin = calcMonthFin(km, ky);
      const prevNet = runningNet;
      const effRev = fin.stay + prevNet;
      const finNet = effRev - fin.expenses;
      runningNet = finNet;

      if (k === monthKey) {
        currentMonthStay = fin.stay;
        previousMonthNet = prevNet;
        totalIncome = effRev;
        totalExpenses = fin.expenses;
        netIncome = finNet;

        activeInvoices = fin.invoices;
        activeAdvances = fin.advances;
        activePatientExpenses = fin.patExp;
        activeDirectOtherSum = fin.directOther;
      }
    });
  }

  // Patient Metrics
  const currentPatientsCount = allPatients.filter(p => p.status === 'current').length;
  let newPatientsCount = 0;
  let dischargedCount = 0;

  if (isAllMonths) {
    newPatientsCount = allPatients.length;
    dischargedCount = allPatients.filter(p => p.status === 'discharged').length;
  } else {
    const { start, end } = getMonthDateRange(targetY, targetM);
    newPatientsCount = allPatients.filter(p => {
      const d = new Date(p.entryDate || p.createdAt);
      return d >= start && d <= end;
    }).length;
    dischargedCount = allPatients.filter(p => {
      if (p.status !== 'discharged' || !p.exitDate) return false;
      const d = new Date(p.exitDate);
      return d >= start && d <= end;
    }).length;
  }

  const outstandingPayments = allPatients.reduce((sum, p) => {
    const pStay = Number(p.accommodationAmount || p.stayValue || 0);
    const pPaid = Number(p.paidAmount ?? p.paid ?? 0);
    return sum + Math.max(0, pStay - pPaid);
  }, 0);

  // Expense Category Breakdown
  const totalAdvancesSum = activeAdvances.reduce((s, a) => s + Number(a.amount || 0), 0);
  const expenseBreakdown = {
    Advances: totalAdvancesSum,
    PatientExpenses: activePatientExpenses,
    Food: 0,
    Medicine: 0,
    Utilities: 0,
    Maintenance: 0,
    Supplies: 0,
    Other: activeDirectOtherSum
  };

  activeInvoices.forEach(inv => {
    const cat = inv.category || '';
    const amt = Number(inv.totalAmount || 0);
    if (cat.includes('أغذية') || cat.includes('طعام') || cat.includes('أكل') || cat === 'Food') {
      expenseBreakdown.Food += amt;
    } else if (cat.includes('أدوية') || cat.includes('علاج') || cat === 'Medicine') {
      expenseBreakdown.Medicine += amt;
    } else if (cat.includes('مرافق') || cat.includes('فواتير') || cat === 'Utilities') {
      expenseBreakdown.Utilities += amt;
    } else if (cat.includes('صيانة') || cat === 'Maintenance') {
      expenseBreakdown.Maintenance += amt;
    } else if (cat.includes('مستلزمات') || cat === 'Supplies') {
      expenseBreakdown.Supplies += amt;
    } else {
      expenseBreakdown.Other += amt;
    }
  });

  const advanceList = activeAdvances.map(a => ({
    id: a._id.toString(),
    employeeName: a.employeeId ? a.employeeId.name : (a.employeeName || 'موظف سابق (محذوف)'),
    role: a.employeeId ? a.employeeId.role : (a.role || ''),
    amount: a.amount,
    date: a.date,
    notes: a.notes
  }));

  // Attendance summary in period
  let attendanceQuery = { ...branchFilter };
  if (!isAllMonths) {
    const { start, end } = getMonthDateRange(targetY, targetM);
    attendanceQuery.date = { $gte: start, $lte: end };
  }
  const attendanceRecords = await Attendance.find(attendanceQuery);

  const attendanceStats = {
    present: attendanceRecords.filter(a => a.status === 'present').length,
    absent: attendanceRecords.filter(a => a.status === 'absent').length,
    leave: attendanceRecords.filter(a => a.status === 'leave').length
  };

  return {
    month: isAllMonths ? 'ALL' : targetM,
    year: targetY,
    summary: {
      currentMonthStay,
      previousMonthNet,
      totalIncome,
      totalExpenses,
      netIncome,
      incomeBreakdown: { Accommodation: totalIncome, Other: 0 },
      expenseBreakdown,
      patientMetrics: {
        current: currentPatientsCount,
        newCount: newPatientsCount,
        discharged: dischargedCount,
        outstandingPayments
      },
      employeeMetrics: {
        attendance: attendanceStats,
        advancesTotal: totalAdvancesSum
      }
    },
    transactions: allTransactions,
    patients: allPatients,
    attendance: attendanceRecords,
    advances: advanceList,
    invoices: activeInvoices,
    employees: allEmployees
  };
};

// GET /api/reports/monthly
const getMonthlyReport = async (req, res, next) => {
  try {
    const now = new Date();
    const month = req.query.month || (now.getMonth() + 1);
    const year = req.query.year || now.getFullYear();

    const reportData = await buildReportData(req.branchFilter, month, year);

    res.json({
      success: true,
      data: reportData.summary
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/reports/comparison
const getBranchComparison = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'ميزة مقارنة الفروع متاحة للأدمن العام فقط' });
    }

    const now = new Date();
    const month = req.query.month || (now.getMonth() + 1);
    const year = req.query.year || now.getFullYear();

    const branches = await Branch.find({});

    const comparisonList = [];

    for (const b of branches) {
      const bReport = await buildReportData({ branchId: b._id }, month, year);
      comparisonList.push({
        branchId: b._id.toString(),
        branchName: b.name,
        status: b.status === 'active' ? 'نشط' : 'معطل',
        income: bReport.summary.totalIncome,
        expenses: bReport.summary.totalExpenses,
        netIncome: bReport.summary.netIncome,
        patientsCount: bReport.summary.patientMetrics.current,
        advancesTotal: bReport.summary.employeeMetrics.advancesTotal
      });
    }

    res.json({
      success: true,
      month: parseInt(month),
      year: parseInt(year),
      data: comparisonList
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/reports/excel
const exportExcel = async (req, res, next) => {
  try {
    const now = new Date();
    const month = req.query.month || (now.getMonth() + 1);
    const year = req.query.year || now.getFullYear();

    let branchName = 'جميع الفروع';
    if (req.effectiveBranchId) {
      const b = await Branch.findById(req.effectiveBranchId);
      if (b) branchName = b.name;
    }

    const reportData = await buildReportData(req.branchFilter, month, year);
    const previousSettlement = Number(reportData?.summary?.previousMonthNet || 0);

    let branchComparison = [];
    if (req.user.role === 'super_admin') {
      const branches = await Branch.find({ status: 'active' });
      for (const b of branches) {
        const bReport = await buildReportData({ branchId: b._id }, month, year);
        branchComparison.push({
          branchName: b.name,
          income: bReport.summary.totalIncome,
          expenses: bReport.summary.totalExpenses,
          netIncome: bReport.summary.netIncome,
          patientsCount: bReport.summary.patientMetrics.current,
          advancesTotal: bReport.summary.employeeMetrics.advancesTotal
        });
      }
    }

    const workbook = await generateMonthlyExcelReport({
      month,
      year,
      branchName,
      summary: reportData.summary,
      transactions: reportData.transactions,
      patients: reportData.patients,
      attendance: reportData.attendance,
      advances: reportData.advances,
      invoices: reportData.invoices,
      employees: reportData.employees,
      branchComparison,
      previousSettlement
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Monthly_Report_${month}_${year}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

module.exports = { getMonthlyReport, getBranchComparison, exportExcel };
