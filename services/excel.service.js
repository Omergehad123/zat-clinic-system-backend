const ExcelJS = require('exceljs');

function styleWorksheet(sheet, { title, subtitle, columns, rows, summaryRow }) {
  sheet.views = [{ rtl: true, showGridLines: true }];

  let currentRow = 1;

  // Title Banner
  if (title) {
    sheet.mergeCells(currentRow, 1, currentRow, columns.length);
    const titleCell = sheet.getCell(currentRow, 1);
    titleCell.value = title;
    titleCell.font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Dark Slate/Navy
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(currentRow).height = 36;
    currentRow++;
  }

  // Subtitle Banner
  if (subtitle) {
    sheet.mergeCells(currentRow, 1, currentRow, columns.length);
    const subCell = sheet.getCell(currentRow, 1);
    subCell.value = subtitle;
    subCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(currentRow).height = 24;
    currentRow++;

    // Spacing row
    sheet.getRow(currentRow).height = 8;
    currentRow++;
  }

  // Table Headers
  const headerRowIndex = currentRow;
  columns.forEach((col, colIdx) => {
    const cell = sheet.getCell(headerRowIndex, colIdx + 1);
    cell.value = col.header;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.headerColor || 'FF1E293B' } };
    cell.alignment = { horizontal: col.align || 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FF94A3B8' } }
    };
  });
  sheet.getRow(headerRowIndex).height = 28;
  currentRow++;

  // Data Rows
  rows.forEach((rowData, rIdx) => {
    const row = sheet.getRow(currentRow);
    const isEven = rIdx % 2 === 0;
    const bg = isEven ? 'FFFFFFFF' : 'FFF8FAFC'; // Zebra striping

    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      let val = rowData[col.key];

      if (col.type === 'currency') {
        cell.value = typeof val === 'number' ? val : (parseFloat(val) || 0);
        cell.numFmt = '#,##0 "ج.م"';
      } else if (col.type === 'number') {
        cell.value = typeof val === 'number' ? val : (parseInt(val) || 0);
        cell.numFmt = '#,##0';
      } else {
        cell.value = val !== undefined && val !== null ? String(val) : '-';
      }

      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = {
        horizontal: col.align || (col.type === 'currency' || col.type === 'number' ? 'center' : 'right'),
        vertical: 'middle'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
    row.height = 24;
    currentRow++;
  });

  // Summary / Total Row
  if (summaryRow) {
    const row = sheet.getRow(currentRow);
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      let val = summaryRow[col.key];

      if (col.type === 'currency') {
        cell.value = typeof val === 'number' ? val : (parseFloat(val) || 0);
        cell.numFmt = '#,##0 "ج.م"';
      } else if (col.type === 'number') {
        cell.value = typeof val === 'number' ? val : (parseInt(val) || 0);
        cell.numFmt = '#,##0';
      } else {
        cell.value = val !== undefined && val !== null ? String(val) : '';
      }

      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Amber highlight
      cell.alignment = {
        horizontal: col.align || (col.type === 'currency' || col.type === 'number' ? 'center' : 'right'),
        vertical: 'middle'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0F172A' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };
    });
    row.height = 26;
  }

  // Column Widths
  columns.forEach((col, colIdx) => {
    let maxLen = (col.header || '').length;
    rows.forEach(r => {
      const v = r[col.key];
      if (v) {
        const len = String(v).length;
        if (len > maxLen) maxLen = len;
      }
    });
    const colObj = sheet.getColumn(colIdx + 1);
    colObj.width = Math.max(col.width || 20, Math.min(maxLen + 8, 48));
  });
}

const generateMonthlyExcelReport = async ({
  month,
  year,
  branchName,
  summary,
  transactions = [],
  patients = [],
  attendance = [],
  advances = [],
  branchComparison = []
}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clinic Management System';
  workbook.created = new Date();

  const periodStr = `الفترة: شهر ${month} - سنة ${year} | الفرع: ${branchName || 'جميع الفروع'}`;

  // Sheet 1: Summary (الملخص المالي والإحصائي)
  const summarySheet = workbook.addWorksheet('الملخص المالي');
  styleWorksheet(summarySheet, {
    title: 'التقرير المالي والإحصائي الشامل للمصحة',
    subtitle: periodStr,
    columns: [
      { header: 'المعيار / البيان المالي', key: 'metric', width: 35, align: 'right', headerColor: 'FF047857' },
      { header: 'القيمة / العدد', key: 'value', width: 25, align: 'center', headerColor: 'FF047857' }
    ],
    rows: [
      { metric: 'إجمالي الإيرادات (Total Income)', value: summary.totalIncome || 0 },
      { metric: 'إجمالي المصروفات والسلف (Total Expenses)', value: summary.totalExpenses || 0 },
      { metric: 'صافي الإيرادات (Net Income)', value: summary.netIncome || 0 },
      { metric: 'عدد النزلاء الحاليين بالفرع', value: summary.patientMetrics?.current || 0 },
      { metric: 'النزلاء الجدد خلال الشهر', value: summary.patientMetrics?.newCount || 0 },
      { metric: 'النزلاء المغادرون خلال الشهر', value: summary.patientMetrics?.discharged || 0 },
      { metric: 'إجمالي المستحقات غير المحصلة من النزلاء', value: summary.patientMetrics?.outstandingPayments || 0 },
      { metric: 'إجمالي سلف الموظفين المسجلة', value: summary.expenseBreakdown?.Advances || 0 }
    ]
  });

  // Sheet 2: Income (سجل الإيرادات)
  const incomeSheet = workbook.addWorksheet('الإيرادات');
  const incomeTx = transactions.filter(t => t.type === 'income');
  const totalIncomeSum = incomeTx.reduce((sum, t) => sum + (t.amount || 0), 0);
  styleWorksheet(incomeSheet, {
    title: 'سجل تفاصيل المقبوضات والإيرادات',
    subtitle: periodStr,
    columns: [
      { header: 'التاريخ', key: 'date', width: 16, align: 'center' },
      { header: 'الفئة', key: 'category', width: 22, align: 'center' },
      { header: 'بيان الحركة / الوصف', key: 'description', width: 40, align: 'right' },
      { header: 'المبلغ (جنيه)', key: 'amount', width: 20, type: 'currency', align: 'center' }
    ],
    rows: incomeTx.map(t => ({
      date: new Date(t.date).toISOString().split('T')[0],
      category: t.category || 'إيراد',
      description: t.description || '-',
      amount: t.amount || 0
    })),
    summaryRow: { description: 'إجمالي الإيرادات:', amount: totalIncomeSum }
  });

  // Sheet 3: Expenses (سجل المصروفات)
  const expenseSheet = workbook.addWorksheet('المصروفات');
  const expenseTx = transactions.filter(t => t.type === 'expense');
  const totalExpenseSum = expenseTx.reduce((sum, t) => sum + (t.amount || 0), 0);
  styleWorksheet(expenseSheet, {
    title: 'سجل تفاصيل المصروفات والنفقات',
    subtitle: periodStr,
    columns: [
      { header: 'التاريخ', key: 'date', width: 16, align: 'center', headerColor: 'FFB91C1C' },
      { header: 'الفئة', key: 'category', width: 22, align: 'center', headerColor: 'FFB91C1C' },
      { header: 'بيان المصروف / الوصف', key: 'description', width: 40, align: 'right', headerColor: 'FFB91C1C' },
      { header: 'المبلغ (جنيه)', key: 'amount', width: 20, type: 'currency', align: 'center', headerColor: 'FFB91C1C' }
    ],
    rows: expenseTx.map(t => ({
      date: new Date(t.date).toISOString().split('T')[0],
      category: t.category || 'مصروف',
      description: t.description || '-',
      amount: t.amount || 0
    })),
    summaryRow: { description: 'إجمالي المصروفات:', amount: totalExpenseSum }
  });

  // Sheet 4: Patients (سجل النزلاء)
  const patientsSheet = workbook.addWorksheet('بيانات النزلاء');
  const totalStay = patients.reduce((s, p) => s + (p.accommodationAmount || 0), 0);
  const totalPaid = patients.reduce((s, p) => s + (p.paidAmount || 0), 0);
  const totalRem = patients.reduce((s, p) => s + (p.remainingAmount || 0), 0);
  styleWorksheet(patientsSheet, {
    title: 'سجل النزلاء والمستحقات المالية',
    subtitle: periodStr,
    columns: [
      { header: 'اسم النزيل', key: 'name', width: 28, align: 'right' },
      { header: 'تاريخ الدخول', key: 'entryDate', width: 16, align: 'center' },
      { header: 'قيمة الإقامة', key: 'accommodationAmount', width: 18, type: 'currency' },
      { header: 'المبلغ المسدد', key: 'paidAmount', width: 18, type: 'currency' },
      { header: 'المتبقي', key: 'remainingAmount', width: 18, type: 'currency' },
      { header: 'حالة النزيل', key: 'status', width: 16, align: 'center' }
    ],
    rows: patients.map(p => ({
      name: p.name,
      entryDate: p.entryDate ? new Date(p.entryDate).toISOString().split('T')[0] : '-',
      accommodationAmount: p.accommodationAmount || 0,
      paidAmount: p.paidAmount || 0,
      remainingAmount: p.remainingAmount || 0,
      status: p.status === 'current' ? 'حالي' : 'مغادر'
    })),
    summaryRow: {
      name: 'الإجمالي العام:',
      accommodationAmount: totalStay,
      paidAmount: totalPaid,
      remainingAmount: totalRem
    }
  });

  // Sheet 5: Employee Advances (سجل السلف)
  const advancesSheet = workbook.addWorksheet('سلف الموظفين');
  const totalAdv = advances.reduce((s, a) => s + (a.amount || 0), 0);
  styleWorksheet(advancesSheet, {
    title: 'كشف سلف الموظفين المسجلة',
    subtitle: periodStr,
    columns: [
      { header: 'اسم الموظف', key: 'employeeName', width: 28, align: 'right' },
      { header: 'الوظيفة / الدور', key: 'role', width: 18, align: 'center' },
      { header: 'تاريخ السلفة', key: 'date', width: 16, align: 'center' },
      { header: 'قيمة السلفة', key: 'amount', width: 18, type: 'currency' },
      { header: 'ملاحظات', key: 'notes', width: 30, align: 'right' }
    ],
    rows: advances.map(a => ({
      employeeName: a.employeeName || '-',
      role: a.role || '-',
      date: a.date ? new Date(a.date).toISOString().split('T')[0] : '-',
      amount: a.amount || 0,
      notes: a.notes || '-'
    })),
    summaryRow: { employeeName: 'إجمالي السلف:', amount: totalAdv }
  });

  // Sheet 6: Branch Comparison (مقارنة الفروع)
  if (branchComparison && branchComparison.length > 0) {
    const branchSheet = workbook.addWorksheet('مقارنة الفروع');
    styleWorksheet(branchSheet, {
      title: 'مقارنة الأداء المالي والإحصائي لكافة الفروع',
      subtitle: periodStr,
      columns: [
        { header: 'اسم الفرع', key: 'branchName', width: 25, align: 'right' },
        { header: 'الإيرادات', key: 'income', width: 18, type: 'currency' },
        { header: 'المصروفات', key: 'expenses', width: 18, type: 'currency' },
        { header: 'صافي الدخل', key: 'netIncome', width: 18, type: 'currency' },
        { header: 'عدد المرضى', key: 'patientsCount', width: 16, type: 'number' },
        { header: 'إجمالي السلف', key: 'advancesTotal', width: 18, type: 'currency' }
      ],
      rows: branchComparison.map(b => ({
        branchName: b.branchName,
        income: b.income || 0,
        expenses: b.expenses || 0,
        netIncome: b.netIncome || 0,
        patientsCount: b.patientsCount || 0,
        advancesTotal: b.advancesTotal || 0
      }))
    });
  }

  return workbook;
};

module.exports = { generateMonthlyExcelReport };

