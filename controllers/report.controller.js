const Transaction = require('../models/Transaction');
const Patient = require('../models/Patient');
const PatientPayment = require('../models/PatientPayment');
const PatientExpense = require('../models/PatientExpense');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const EmployeeAdvance = require('../models/EmployeeAdvance');
const Branch = require('../models/Branch');
const { generateMonthlyExcelReport } = require('../services/excel.service');

// Helper to gather metrics for a specific filter and month/year
const buildReportData = async (branchFilter, month, year) => {
  const m = parseInt(month) - 1;
  const y = parseInt(year);
  const startOfMonth = new Date(y, m, 1);
  const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);

  const dateFilter = { date: { $gte: startOfMonth, $lte: endOfMonth } };

  // 1. All Patients metrics & patient net revenues
  const allPatients = await Patient.find({ ...branchFilter });
  const currentPatientsCount = allPatients.filter(p => p.status === 'current').length;

  const newPatientsCount = await Patient.countDocuments({
    ...branchFilter,
    entryDate: { $gte: startOfMonth, $lte: endOfMonth }
  });

  const dischargedCount = await Patient.countDocuments({
    ...branchFilter,
    status: 'discharged',
    exitDate: { $gte: startOfMonth, $lte: endOfMonth }
  });

  let outstandingPayments = 0;
  let totalPatientPaid = 0;
  let totalPatientExpenses = 0;
  let patientNetRevenueTotal = 0;
  const patientDetailedList = [];

  for (const patient of allPatients) {
    const payments = await PatientPayment.find({ patientId: patient._id });
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const expenses = await PatientExpense.find({ patientId: patient._id });
    const pExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const remaining = Math.max(0, (patient.accommodationAmount || 0) - totalPaid);
    const pNet = totalPaid - pExpenses;

    outstandingPayments += remaining;
    totalPatientPaid += totalPaid;
    totalPatientExpenses += pExpenses;
    patientNetRevenueTotal += pNet;

    patientDetailedList.push({
      id: patient._id.toString(),
      name: patient.name,
      entryDate: patient.entryDate,
      accommodationAmount: patient.accommodationAmount || 0,
      paidAmount: totalPaid,
      remainingAmount: remaining,
      totalExpenses: pExpenses,
      netRevenue: pNet,
      status: patient.status
    });
  }

  // 2. Transactions & Expenses
  const transactions = await Transaction.find({
    ...branchFilter
  });

  const expenseBreakdown = {
    Food: 0,
    Medicine: 0,
    Utilities: 0,
    Maintenance: 0,
    Supplies: 0,
    Advances: 0,
    PatientExpenses: totalPatientExpenses,
    Other: 0
  };

  let generalExpensesSum = 0;
  transactions.forEach(t => {
    if (t.type === 'expense') {
      const cat = t.category || '';
      if (cat === 'Employee Advances' || cat.includes('سلف')) {
        expenseBreakdown.Advances += t.amount;
        generalExpensesSum += t.amount;
      } else if (cat === 'PatientExpense' || cat === 'Patient Expense' || cat.includes('مصاريف النزيل') || cat.includes('مصاريف ابتدائية')) {
        // Handled via totalPatientExpenses
      } else if (cat === 'Food' || cat.includes('أكل')) {
        expenseBreakdown.Food += t.amount;
        generalExpensesSum += t.amount;
      } else if (cat === 'Medicine' || cat.includes('أدوية')) {
        expenseBreakdown.Medicine += t.amount;
        generalExpensesSum += t.amount;
      } else if (cat === 'Utilities' || cat.includes('مرافق')) {
        expenseBreakdown.Utilities += t.amount;
        generalExpensesSum += t.amount;
      } else if (cat === 'Maintenance' || cat.includes('صيانة')) {
        expenseBreakdown.Maintenance += t.amount;
        generalExpensesSum += t.amount;
      } else if (cat === 'Supplies' || cat.includes('مستلزمات')) {
        expenseBreakdown.Supplies += t.amount;
        generalExpensesSum += t.amount;
      } else {
        expenseBreakdown.Other += t.amount;
        generalExpensesSum += t.amount;
      }
    }
  });

  // 1. إجمالي الإيرادات = مجموع صافي إيرادات النزلاء (المدفوع - مصاريف النزيل)
  const totalIncome = allPatients.length > 0 ? patientNetRevenueTotal : totalPatientPaid;

  // 2. إجمالي المصروفات والسلف = مجموع كل الفواتير والمصروفات العامة + السلف + مصاريف النزلاء
  const totalExpenses = generalExpensesSum + totalPatientExpenses;

  // 3. صافي الإيرادات = إجمالي الإيرادات - إجمالي المصروفات والسلف
  const netIncome = totalIncome - totalExpenses;

  const incomeBreakdown = {
    Accommodation: totalIncome,
    Other: 0
  };

  // 3. Employee Advances in month
  const advances = await EmployeeAdvance.find({
    ...branchFilter,
    ...dateFilter
  }).populate('employeeId', 'name role');

  const advanceList = advances.map(a => ({
    id: a._id.toString(),
    employeeName: a.employeeId ? a.employeeId.name : (a.employeeName || 'موظف سابق (محذوف)'),
    role: a.employeeId ? a.employeeId.role : (a.role || ''),
    amount: a.amount,
    date: a.date,
    notes: a.notes
  }));

  // 4. Attendance summary in month
  const attendanceRecords = await Attendance.find({
    ...branchFilter,
    ...dateFilter
  });

  const attendanceStats = {
    present: attendanceRecords.filter(a => a.status === 'present').length,
    absent: attendanceRecords.filter(a => a.status === 'absent').length,
    leave: attendanceRecords.filter(a => a.status === 'leave').length
  };

  return {
    month: parseInt(month),
    year: parseInt(year),
    summary: {
      totalIncome,
      totalExpenses,
      netIncome,
      incomeBreakdown,
      expenseBreakdown,
      patientMetrics: {
        current: currentPatientsCount,
        newCount: newPatientsCount,
        discharged: dischargedCount,
        outstandingPayments
      },
      employeeMetrics: {
        attendance: attendanceStats,
        advancesTotal: expenseBreakdown.Advances
      }
    },
    transactions,
    patients: patientDetailedList,
    attendance: attendanceRecords,
    advances: advanceList
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
      branchComparison
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
