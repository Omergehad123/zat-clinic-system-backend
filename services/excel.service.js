const ExcelJS = require('exceljs');

const generateMonthlyExcelReport = async ({
  month,
  year,
  branchName,
  summary,
  transactions,
  patients,
  attendance,
  advances,
  branchComparison
}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clinic Management System';
  workbook.created = new Date();

  // Sheet 1: Summary
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'المقياس (Metric)', key: 'metric', width: 30 },
    { header: 'القيمة (EGP / Count)', key: 'value', width: 25 }
  ];

  summarySheet.addRows([
    { metric: 'الشهر والسنوات (Month/Year)', value: `${month}/${year}` },
    { metric: 'الفرع (Branch)', value: branchName || 'جميع الفروع' },
    { metric: 'إجمالي الإيرادات (Total Income)', value: summary.totalIncome },
    { metric: 'إجمالي المصروفات (Total Expenses)', value: summary.totalExpenses },
    { metric: 'صافي الدخل (Net Income)', value: summary.netIncome },
    { metric: 'عدد المرضى الحاليين (Current Patients)', value: summary.patientMetrics.current },
    { metric: 'المرضى الجدد (New Patients)', value: summary.patientMetrics.newCount },
    { metric: 'المرضى الخرجين (Discharged)', value: summary.patientMetrics.discharged },
    { metric: 'إجمالي المتبقي غير المحصل (Outstanding)', value: summary.patientMetrics.outstandingPayments },
    { metric: 'إجمالي السلف للموظفين (Employee Advances)', value: summary.expenseBreakdown.Advances }
  ]);

  // Sheet 2: Income
  const incomeSheet = workbook.addWorksheet('Income');
  incomeSheet.columns = [
    { header: 'التاريخ', key: 'date', width: 15 },
    { header: 'الفئة', key: 'category', width: 20 },
    { header: 'الوصف', key: 'description', width: 35 },
    { header: 'المبلغ (EGP)', key: 'amount', width: 15 }
  ];

  const incomeTx = transactions.filter(t => t.type === 'income');
  incomeTx.forEach(t => {
    incomeSheet.addRow({
      date: new Date(t.date).toISOString().split('T')[0],
      category: t.category,
      description: t.description,
      amount: t.amount
    });
  });

  // Sheet 3: Expenses
  const expenseSheet = workbook.addWorksheet('Expenses');
  expenseSheet.columns = [
    { header: 'التاريخ', key: 'date', width: 15 },
    { header: 'الفئة', key: 'category', width: 20 },
    { header: 'الوصف', key: 'description', width: 35 },
    { header: 'المبلغ (EGP)', key: 'amount', width: 15 }
  ];

  const expenseTx = transactions.filter(t => t.type === 'expense');
  expenseTx.forEach(t => {
    expenseSheet.addRow({
      date: new Date(t.date).toISOString().split('T')[0],
      category: t.category,
      description: t.description,
      amount: t.amount
    });
  });

  // Sheet 4: Patients
  const patientsSheet = workbook.addWorksheet('Patients');
  patientsSheet.columns = [
    { header: 'اسم المريض', key: 'name', width: 25 },
    { header: 'تاريخ الدخول', key: 'entryDate', width: 15 },
    { header: 'مبلغ الإقامة', key: 'accommodationAmount', width: 15 },
    { header: 'المسدد', key: 'paidAmount', width: 15 },
    { header: 'المتبقي', key: 'remainingAmount', width: 15 },
    { header: 'الحالة', key: 'status', width: 15 }
  ];

  patients.forEach(p => {
    patientsSheet.addRow({
      name: p.name,
      entryDate: new Date(p.entryDate).toISOString().split('T')[0],
      accommodationAmount: p.accommodationAmount,
      paidAmount: p.paidAmount,
      remainingAmount: p.remainingAmount,
      status: p.status === 'current' ? 'حالي' : 'مغادر'
    });
  });

  // Sheet 5: Employee Advances
  const advancesSheet = workbook.addWorksheet('Employee Advances');
  advancesSheet.columns = [
    { header: 'اسم الموظف', key: 'employeeName', width: 25 },
    { header: 'الدور', key: 'role', width: 15 },
    { header: 'التاريخ', key: 'date', width: 15 },
    { header: 'المبلغ (EGP)', key: 'amount', width: 15 },
    { header: 'ملاحظات', key: 'notes', width: 25 }
  ];

  advances.forEach(a => {
    advancesSheet.addRow({
      employeeName: a.employeeName,
      role: a.role,
      date: new Date(a.date).toISOString().split('T')[0],
      amount: a.amount,
      notes: a.notes
    });
  });

  // Sheet 6: Branch Summary
  if (branchComparison && branchComparison.length > 0) {
    const branchSheet = workbook.addWorksheet('Branch Summary');
    branchSheet.columns = [
      { header: 'الفرع', key: 'branchName', width: 25 },
      { header: 'الإيرادات', key: 'income', width: 15 },
      { header: 'المصروفات', key: 'expenses', width: 15 },
      { header: 'صافي الدخل', key: 'netIncome', width: 15 },
      { header: 'عدد المرضى', key: 'patientsCount', width: 15 },
      { header: 'إجمالي السلف', key: 'advancesTotal', width: 15 }
    ];

    branchComparison.forEach(b => {
      branchSheet.addRow({
        branchName: b.branchName,
        income: b.income,
        expenses: b.expenses,
        netIncome: b.netIncome,
        patientsCount: b.patientsCount,
        advancesTotal: b.advancesTotal
      });
    });
  }

  return workbook;
};

module.exports = { generateMonthlyExcelReport };
