const ExcelJS = require('exceljs');

const COLORS = {
  headerDark: 'FF0F172A',
  headerNavy: 'FF1E293B',
  bannerYellow: 'FFFFF2CC',     // Soft yellow title banner (Images 2, 3, 4)
  bannerGreen: 'FFE2EFDA',      // Soft green title banner (Image 5)
  sectionBlue: 'FFBDD7EE',      // Header "تفاصيل الاقامة" (Image 1)
  netGreen: 'FFA9D08E',         // Header & column "صافي" (Image 1)
  brightYellow: 'FFFFFF00',     // Column "الباقي" & "تصفية الشهر السابق" (Images 1, 5)
  softPeach: 'FFFCE4D6',        // "الايرادات" & "المصاريف" header (Image 5)
  lightBlueTotal: 'FFD9E1F2',   // Left total box / Net box (Images 2, 3, 5)
  borderGray: 'FF94A3B8',
  borderLight: 'FFE2E8F0',
  white: 'FFFFFFFF',
  black: 'FF000000',
  textGray: 'FF475569'
};

const BORDER_THIN = {
  top: { style: 'thin', color: { argb: COLORS.borderGray } },
  left: { style: 'thin', color: { argb: COLORS.borderGray } },
  bottom: { style: 'thin', color: { argb: COLORS.borderGray } },
  right: { style: 'thin', color: { argb: COLORS.borderGray } }
};

const BORDER_DOUBLE_BOTTOM = {
  top: { style: 'thin', color: { argb: COLORS.black } },
  left: { style: 'thin', color: { argb: COLORS.borderGray } },
  bottom: { style: 'double', color: { argb: COLORS.black } },
  right: { style: 'thin', color: { argb: COLORS.borderGray } }
};

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

function getArabicMonthName(month) {
  const m = parseInt(month, 10);
  if (isNaN(m) || m < 1 || m > 12) return month || '';
  return ARABIC_MONTHS[m - 1];
}

function formatExcelDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function getDaysInMonth(year, month) {
  if (month === 'all' || !month) return 30;
  return new Date(Number(year), Number(month), 0).getDate();
}

function formatDateToKey(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildMonthPatientRows(patients = [], targetMonth, targetYear) {
  const isAll = targetMonth === 'all' || targetMonth === 'ALL';
  const monthKey = !isAll ? `${targetYear}-${String(targetMonth).padStart(2, '0')}` : null;

  const rows = [];

  patients.forEach((patient) => {
    const pStay = Number(patient.accommodationAmount ?? patient.stayValue ?? 0);
    const pPaid = Number(patient.paidAmount ?? patient.paid ?? 0);
    const pRem = Number(patient.remainingAmount ?? patient.remaining ?? Math.max(0, pStay - pPaid));
    const pExpenses = Number(patient.totalExpenses ?? patient.expensesTotal ?? 0);

    const timeline = Array.isArray(patient.timeline) ? patient.timeline : [];
    const entryEvent = timeline.find(e => e.type === 'entry');
    const renewalEvents = timeline.filter(e => e.type === 'renewal');
    const sumRenewals = renewalEvents.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const entryKey = formatDateToKey(patient.entryDate || patient.createdAt);
    const lastRenKey = formatDateToKey(patient.lastRenewalDate || patient.renewalDate);
    const hasExternalRenewal = lastRenKey && lastRenKey !== entryKey;
    const hasRenewals = renewalEvents.length > 0 || hasExternalRenewal;

    let entryStay = 0;
    if (entryEvent && entryEvent.amount) {
      entryStay = Number(entryEvent.amount);
    } else if (sumRenewals > 0) {
      entryStay = Math.max(0, pStay - sumRenewals);
    } else if (hasExternalRenewal) {
      const periods = (Number(patient.renewalsCount) || 1) + 1;
      entryStay = periods > 0 ? Math.round(pStay / periods) : pStay;
    } else {
      entryStay = pStay;
    }

    const calcExpForMonth = (mKey, fallback) => {
      const pExpList = Array.isArray(patient.expenses) ? patient.expenses : [];
      const mExps = pExpList.filter(e => formatDateToKey(e.date) === mKey);
      if (mExps.length > 0) return mExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return fallback !== undefined ? Number(fallback) : (renewalEvents.length > 0 ? 0 : pExpenses);
    };

    let unallocatedPaid = pPaid;
    const isSettled = pRem <= 0;

    // 1. Entry Row
    if (isAll || entryKey === monthKey) {
      const entryPaid = isSettled ? entryStay : Math.min(entryStay, unallocatedPaid);
      const entryRemaining = isSettled ? 0 : Math.max(0, entryStay - entryPaid);
      unallocatedPaid = Math.max(0, unallocatedPaid - entryPaid);
      const entryExp = calcExpForMonth(entryKey, entryEvent?.initialExpenses);

      let renDisplay = '-';
      if (patient.status === 'خرج' || patient.status === 'discharged') {
        renDisplay = patient.exitDate ? `خروج ${new Date(patient.exitDate).getMonth() + 1}/${new Date(patient.exitDate).getDate()}` : 'خروج';
      } else if (lastRenKey && lastRenKey !== entryKey) {
        renDisplay = formatExcelDate(patient.lastRenewalDate || patient.renewalDate);
      }

      rows.push({
        patient,
        entryDate: patient.entryDate,
        renewalDate: renDisplay,
        monthStayValue: entryStay,
        monthPaid: entryPaid,
        monthRemaining: entryRemaining,
        monthExpenses: entryExp,
        monthNet: entryPaid - entryExp,
        note: patient.notes || ''
      });
    } else {
      const entryPaid = isSettled ? entryStay : Math.min(entryStay, unallocatedPaid);
      unallocatedPaid = Math.max(0, unallocatedPaid - entryPaid);
    }

    // 2. Renewal Events
    const seenRenMonths = new Set();
    renewalEvents.forEach((renEvent, idx) => {
      const renKey = formatDateToKey(renEvent.date);
      if (!renKey || seenRenMonths.has(renKey)) return;
      seenRenMonths.add(renKey);

      const renStay = Number(renEvent.amount || 0);
      const isLast = idx === renewalEvents.length - 1;
      let renPaid = 0;
      let renRem = 0;

      if (isSettled) {
        renPaid = renStay;
        renRem = 0;
      } else if (isLast) {
        renRem = pRem;
        renPaid = Math.max(0, renStay - renRem);
      } else {
        renPaid = Math.min(renStay, unallocatedPaid);
        renRem = Math.max(0, renStay - renPaid);
        unallocatedPaid = Math.max(0, unallocatedPaid - renPaid);
      }

      if (isAll || renKey === monthKey) {
        const renExp = calcExpForMonth(renKey, renEvent.initialExpenses);
        rows.push({
          patient,
          entryDate: patient.entryDate,
          renewalDate: formatExcelDate(renEvent.date),
          monthStayValue: renStay,
          monthPaid: renPaid,
          monthRemaining: renRem,
          monthExpenses: renExp,
          monthNet: renPaid - renExp,
          note: `تجديد #${idx + 1}${patient.notes ? ` - ${patient.notes}` : ''}`
        });
      }
    });

    // 3. Fallback for lastRenewalDate if not in timeline
    if (lastRenKey && !seenRenMonths.has(lastRenKey) && lastRenKey !== entryKey) {
      const fallbackStay = Math.max(0, pStay - entryStay);
      const renPaid = isSettled ? fallbackStay : Math.max(0, fallbackStay - pRem);
      const renRem = isSettled ? 0 : pRem;

      if (isAll || lastRenKey === monthKey) {
        const fallbackExp = calcExpForMonth(lastRenKey, undefined);
        rows.push({
          patient,
          entryDate: patient.entryDate,
          renewalDate: formatExcelDate(patient.lastRenewalDate || patient.renewalDate),
          monthStayValue: fallbackStay,
          monthPaid: renPaid,
          monthRemaining: renRem,
          monthExpenses: fallbackExp,
          monthNet: renPaid - fallbackExp,
          note: `تجديد${patient.notes ? ` - ${patient.notes}` : ''}`
        });
      }
    }
  });

  return rows;
}

/**
 * SHEET 1: نزلاء (Matching Image 1)
 */
function buildPatientsSheet(workbook, patients = [], month, year, branchName) {
  const sheet = workbook.addWorksheet('نزلاء');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const isAll = month === 'all' || month === 'ALL';
  const monthTitle = isAll ? `كافة شهور عام ${year}` : `${getArabicMonthName(month)} ${year}`;

  const monthItems = buildMonthPatientRows(patients, month, year);

  // Title Banner
  sheet.mergeCells(1, 1, 1, 11);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `كشف النزلاء والإقامة والمصروفات — ${monthTitle} — ${branchName || 'فرع المصحة'}`;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerNavy } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  // Header Rows
  sheet.mergeCells(2, 1, 3, 1);
  sheet.getCell(2, 1).value = 'م';

  sheet.mergeCells(2, 2, 3, 2);
  sheet.getCell(2, 2).value = 'اسم المريض(رباعي)';

  sheet.mergeCells(2, 3, 3, 3);
  sheet.getCell(2, 3).value = 'الرقم الطبي\n(Medical ID)';

  sheet.getCell(2, 4).value = 'تاريخ الدخول';
  sheet.getCell(3, 4).value = 'يوم';

  sheet.getCell(2, 5).value = 'تاريخ التجديد';
  sheet.getCell(3, 5).value = 'يوم';

  sheet.mergeCells(2, 6, 2, 8);
  sheet.getCell(2, 6).value = 'تفاصيل الاقامة';
  sheet.getCell(3, 6).value = 'القيمة';
  sheet.getCell(3, 7).value = 'المدفوع';
  sheet.getCell(3, 8).value = 'الباقي';

  sheet.mergeCells(2, 9, 3, 9);
  sheet.getCell(2, 9).value = 'مصاريف';

  sheet.mergeCells(2, 10, 3, 10);
  sheet.getCell(2, 10).value = 'صافي';

  sheet.mergeCells(2, 11, 3, 11);
  sheet.getCell(2, 11).value = 'ملاحظات';

  for (let r = 2; r <= 3; r++) {
    sheet.getRow(r).height = 24;
    for (let c = 1; c <= 11; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = BORDER_THIN;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

      if (c === 5 && r === 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bannerYellow } };
      }
      if (c >= 6 && c <= 8 && r === 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sectionBlue } };
      }
      if (c === 8 && r === 3) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brightYellow } };
      }
      if (c === 10) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.netGreen } };
      }
    }
  }

  let currentRow = 4;
  let totalValue = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  let totalExpenses = 0;
  let totalNet = 0;

  monthItems.forEach((item, idx) => {
    const row = sheet.getRow(currentRow);
    row.height = 22;

    const patient = item.patient || {};
    const stay = Number(item.monthStayValue || 0);
    const paid = Number(item.monthPaid || 0);
    const rem = Number(item.monthRemaining || 0);
    const expenses = Number(item.monthExpenses || 0);
    const net = Number(item.monthNet !== undefined ? item.monthNet : (paid - expenses));
    const remainingSigned = rem > 0 ? -rem : 0;

    totalValue += stay;
    totalPaid += paid;
    totalRemaining += remainingSigned;
    totalExpenses += expenses;
    totalNet += net;

    const medId = patient.medicalId || patient.code || (idx + 1);

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = patient.name || '-';
    row.getCell(3).value = medId;
    row.getCell(4).value = formatExcelDate(item.entryDate || patient.entryDate);
    row.getCell(5).value = item.renewalDate || '-';
    row.getCell(6).value = stay;
    row.getCell(7).value = paid;
    row.getCell(8).value = remainingSigned;
    row.getCell(9).value = expenses;
    row.getCell(10).value = net;
    row.getCell(11).value = item.note || '';

    for (let c = 1; c <= 11; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 10, color: { argb: COLORS.black } };
      cell.alignment = { 
        horizontal: (c === 2 || c === 11) ? 'right' : 'center', 
        vertical: 'middle' 
      };

      if (c === 8) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brightYellow } };
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
        cell.numFmt = '#,##0;[Red]-#,##0;0';
      } else if (c === 10) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.netGreen } };
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
        cell.numFmt = '#,##0;[Red]-#,##0;0';
      } else if (c >= 6 && c <= 9) {
        cell.numFmt = '#,##0';
      }
    }

    currentRow++;
  });

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 26;
  sheet.mergeCells(currentRow, 1, currentRow, 5);
  sumRow.getCell(1).value = `الإجمالي (${monthItems.length} حركة / نزيل)`;
  sumRow.getCell(6).value = totalValue;
  sumRow.getCell(7).value = totalPaid;
  sumRow.getCell(8).value = totalRemaining;
  sumRow.getCell(9).value = totalExpenses;
  sumRow.getCell(10).value = totalNet;
  sumRow.getCell(11).value = '';

  for (let c = 1; c <= 11; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    if (c === 8) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brightYellow } };
      cell.numFmt = '#,##0;[Red]-#,##0;0';
    } else if (c === 10) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.netGreen } };
      cell.numFmt = '#,##0;[Red]-#,##0;0';
    } else if (c >= 6 && c <= 9) {
      cell.numFmt = '#,##0';
    }
  }

  const widths = [6, 26, 16, 14, 16, 13, 13, 13, 13, 14, 25];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

/**
 * Helper to build Attendance + Advance grid for employees (Image 2 & 3)
 */
function buildEmployeeAttendanceMatrix(sheet, {
  title,
  employees = [],
  attendanceRecords = [],
  advances = [],
  month,
  year
}) {
  sheet.views = [{ rtl: true, showGridLines: true }];
  const daysInMonth = getDaysInMonth(year, month);
  const mNum = month === 'all' || month === 'ALL' ? 10 : Number(month);
  const yNum = Number(year) || new Date().getFullYear();

  const totalCols = 1 + (employees.length * 2) + 1;

  sheet.mergeCells(1, 1, 1, Math.max(totalCols, 4));
  const banner = sheet.getCell(1, 1);
  banner.value = title;
  banner.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.black } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bannerYellow } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 3, 1);
  sheet.getCell(2, 1).value = 'التاريخ';

  employees.forEach((emp, i) => {
    const startCol = 2 + (i * 2);
    const endCol = startCol + 1;

    let displayTitle = emp.name;
    if (emp.role === 'doctor') {
      displayTitle = `د/ ${emp.name}${emp.specialization ? ` (${emp.specialization})` : ''}`;
    } else if (emp.role === 'nurse') {
      displayTitle = `تمريض/ ${emp.name}`;
    } else if (emp.role === 'supervisor') {
      displayTitle = `مشرف/ ${emp.name}`;
    }

    sheet.mergeCells(2, startCol, 2, endCol);
    sheet.getCell(2, startCol).value = displayTitle;

    sheet.getCell(3, startCol).value = 'حضور';
    sheet.getCell(3, endCol).value = 'سلفة';
  });

  const grandTotalCol = 1 + (employees.length * 2) + 1;
  sheet.mergeCells(2, grandTotalCol, 3, grandTotalCol);
  sheet.getCell(2, grandTotalCol).value = 'اجمالي';

  for (let r = 2; r <= 3; r++) {
    sheet.getRow(r).height = 24;
    for (let c = 1; c <= grandTotalCol; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = BORDER_THIN;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

      if (c === grandTotalCol) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlueTotal } };
      }
    }
  }

  const advancesMap = {};
  advances.forEach(adv => {
    if (!adv.date) return;
    const ad = new Date(adv.date);
    if (month !== 'all' && month !== 'ALL' && (ad.getMonth() + 1) !== mNum) return;
    if (ad.getFullYear() !== yNum) return;

    const day = ad.getDate();
    const empId = String(adv.employeeId?._id || adv.employeeId || '');
    const empName = adv.employeeName || '';

    const targetEmp = employees.find(e => 
      (e._id && String(e._id) === empId) || (e.id && String(e.id) === empId) || e.name === empName
    );

    if (targetEmp) {
      const key = `${targetEmp._id || targetEmp.id}_${day}`;
      advancesMap[key] = (advancesMap[key] || 0) + (Number(adv.amount) || 0);
    }
  });

  const attMap = {};
  attendanceRecords.forEach(att => {
    if (!att.date) return;
    const ad = new Date(att.date);
    if (month !== 'all' && month !== 'ALL' && (ad.getMonth() + 1) !== mNum) return;
    if (ad.getFullYear() !== yNum) return;

    const day = ad.getDate();
    const empId = String(att.employeeId?._id || att.employeeId || '');
    const key = `${empId}_${day}`;
    attMap[key] = att.status;
  });

  let currentRow = 4;
  const empAttTotals = new Array(employees.length).fill(0);
  const empAdvTotals = new Array(employees.length).fill(0);
  let monthGrandAdvTotal = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const row = sheet.getRow(currentRow);
    row.height = 20;

    const dateStr = `${yNum}/${String(mNum).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    row.getCell(1).value = dateStr;

    let dayTotalAdvances = 0;

    employees.forEach((emp, i) => {
      const empKeyId = emp._id || emp.id;
      const attStatus = attMap[`${empKeyId}_${d}`];
      const advAmt = advancesMap[`${empKeyId}_${d}`] || 0;

      const attCol = 2 + (i * 2);
      const advCol = attCol + 1;

      if (attStatus === 'present') {
        row.getCell(attCol).value = 'حضور';
        empAttTotals[i]++;
      } else if (attStatus === 'absent') {
        row.getCell(attCol).value = 0;
      } else if (attStatus === 'leave') {
        row.getCell(attCol).value = 'إجازة';
      } else {
        row.getCell(attCol).value = 0;
      }

      if (advAmt > 0) {
        row.getCell(advCol).value = advAmt;
        empAdvTotals[i] += advAmt;
        dayTotalAdvances += advAmt;
      } else {
        row.getCell(advCol).value = '';
      }
    });

    monthGrandAdvTotal += dayTotalAdvances;
    row.getCell(grandTotalCol).value = dayTotalAdvances > 0 ? dayTotalAdvances : 0;

    for (let c = 1; c <= grandTotalCol; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };

      if (c === grandTotalCol) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlueTotal } };
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
      }
    }

    currentRow++;
  }

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 28;
  sumRow.getCell(1).value = 'اجمالي';

  employees.forEach((emp, i) => {
    const attCol = 2 + (i * 2);
    const advCol = attCol + 1;

    sumRow.getCell(attCol).value = empAttTotals[i];
    sumRow.getCell(advCol).value = empAdvTotals[i];
  });

  sumRow.getCell(grandTotalCol).value = monthGrandAdvTotal;

  for (let c = 1; c <= grandTotalCol; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    if (c === grandTotalCol) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlueTotal } };
      cell.font = { name: 'Arial', size: 13, bold: true, color: { argb: COLORS.black } };
    }
  }

  sheet.getColumn(1).width = 14;
  for (let i = 0; i < employees.length; i++) {
    sheet.getColumn(2 + (i * 2)).width = 10;
    sheet.getColumn(3 + (i * 2)).width = 10;
  }
  sheet.getColumn(grandTotalCol).width = 14;
}

/**
 * SHEET 2: الدكاترة والتمريض (Matching Image 2)
 */
function buildDoctorsAttendanceSheet(workbook, employees = [], attendance = [], advances = [], month, year) {
  const doctorsAndNurses = employees.filter(e => 
    e.role === 'doctor' || e.role === 'nurse' || e.type === 'دكتور' || e.type === 'تمريض'
  );

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;
  const title = `كشف حضور وسلف الدكاترة والتمريض لشهر ${monthName}`;

  const sheet = workbook.addWorksheet('الدكاترة والتمريض');
  buildEmployeeAttendanceMatrix(sheet, {
    title,
    employees: doctorsAndNurses,
    attendanceRecords: attendance,
    advances,
    month,
    year
  });
}

/**
 * SHEET 3: المشرفيين والعمال (Matching Image 3)
 */
function buildStaffAttendanceSheet(workbook, employees = [], attendance = [], advances = [], month, year) {
  const staff = employees.filter(e => 
    e.role === 'supervisor' || e.role === 'worker' || e.type === 'مشرف' || e.type === 'عامل'
  );

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;
  const title = `كشف حضور وسلف المشرفيين والعمال لشهر ${monthName}`;

  const sheet = workbook.addWorksheet('المشرفيين والعمال');
  buildEmployeeAttendanceMatrix(sheet, {
    title,
    employees: staff,
    attendanceRecords: attendance,
    advances,
    month,
    year
  });
}

/**
 * SHEET 4: مصاريف يومية (Matching Image 4)
 */
function buildDailyExpensesSheet(workbook, invoices = [], transactions = [], month, year) {
  const sheet = workbook.addWorksheet('مصاريف يومية');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;
  const title = `خزين شهر ${monthName}`;

  sheet.mergeCells(1, 1, 1, 6);
  const banner = sheet.getCell(1, 1);
  banner.value = title;
  banner.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.black } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bannerYellow } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const headers = ['التاريخ', 'الصنف', 'العدد', 'الكمية', 'السعر', 'ملاحظات'];
  const hRow = sheet.getRow(2);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  const items = [];
  const mNum = (month === 'all' || month === 'ALL') ? null : Number(month);
  const yNum = Number(year) || new Date().getFullYear();

  invoices.forEach(inv => {
    if (!inv.date) return;
    const id = new Date(inv.date);
    if (mNum && (id.getMonth() + 1) !== mNum) return;
    if (id.getFullYear() !== yNum) return;

    const dateStr = formatExcelDate(inv.date);
    if (Array.isArray(inv.items) && inv.items.length > 0) {
      inv.items.forEach(it => {
        items.push({
          date: dateStr,
          rawDate: id,
          name: it.itemName || it.name || inv.category || 'مشتريات',
          count: it.count || it.quantity || 1,
          quantity: it.quantity || '',
          price: it.total || (it.price * (it.count || 1)) || 0,
          notes: it.notes || inv.notes || ''
        });
      });
    } else {
      items.push({
        date: dateStr,
        rawDate: id,
        name: inv.category || 'فاتورة مصروفات',
        count: 1,
        quantity: '',
        price: Number(inv.totalAmount || 0),
        notes: inv.notes || ''
      });
    }
  });

  transactions.forEach(t => {
    if (t.type !== 'expense') return;
    if (!t.date) return;
    const td = new Date(t.date);
    if (mNum && (td.getMonth() + 1) !== mNum) return;
    if (td.getFullYear() !== yNum) return;

    const cat = t.category || '';
    if (cat.includes('سلف') || cat.includes('Advances') || cat.includes('PatientExpense')) return;
    if (t.invoiceId) return;

    items.push({
      date: formatExcelDate(t.date),
      rawDate: td,
      name: t.description || cat || 'مصروف عام',
      count: 1,
      quantity: '',
      price: Number(t.amount || 0),
      notes: t.notes || ''
    });
  });

  items.sort((a, b) => (a.rawDate || 0) - (b.rawDate || 0));

  let currentRow = 3;
  let totalExpenses = 0;

  items.forEach(it => {
    const row = sheet.getRow(currentRow);
    row.height = 20;
    totalExpenses += Number(it.price || 0);

    row.getCell(1).value = it.date;
    row.getCell(2).value = it.name;
    row.getCell(3).value = it.count || '';
    row.getCell(4).value = it.quantity || '';
    row.getCell(5).value = it.price || 0;
    row.getCell(6).value = it.notes || '';

    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
      cell.alignment = { 
        horizontal: c === 2 ? 'right' : 'center', 
        vertical: 'middle' 
      };
      if (c === 5) cell.numFmt = '#,##0';
    }
    currentRow++;
  });

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 26;
  sheet.mergeCells(currentRow, 1, currentRow, 4);
  sumRow.getCell(1).value = `إجمالي المصاريف (${items.length} بند)`;
  sumRow.getCell(5).value = totalExpenses;
  sumRow.getCell(6).value = '';

  for (let c = 1; c <= 6; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (c === 5) cell.numFmt = '#,##0 "ج.م"';
  }

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 10;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 24;
}

/**
 * SHEET 5: فواتير
 */
function buildInvoicesSheet(workbook, invoices = [], month, year) {
  const sheet = workbook.addWorksheet('فواتير');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;

  sheet.mergeCells(1, 1, 1, 8);
  const banner = sheet.getCell(1, 1);
  banner.value = `سجل فواتير المصروفات — ${monthName}`;
  banner.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.white } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerNavy } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const headers = ['م', 'رقم الفاتورة', 'التاريخ', 'التصنيف', 'بيان الأصناف', 'عدد الأصناف', 'المبلغ الإجمالي', 'ملاحظات'];
  const hRow = sheet.getRow(2);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  const mNum = (month === 'all' || month === 'ALL') ? null : Number(month);
  const yNum = Number(year) || new Date().getFullYear();

  const filtered = invoices.filter(inv => {
    if (!inv.date) return false;
    const id = new Date(inv.date);
    if (mNum && (id.getMonth() + 1) !== mNum) return false;
    if (id.getFullYear() !== yNum) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

  let currentRow = 3;
  let totalSum = 0;

  filtered.forEach((inv, idx) => {
    const row = sheet.getRow(currentRow);
    row.height = 22;
    const amt = Number(inv.totalAmount || 0);
    totalSum += amt;

    const itemsSummary = (inv.items || []).map(it => it.name || it.itemName).filter(Boolean).join('، ');

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = inv.invoiceNumber || (inv.id ? `#${inv.id.slice(-6)}` : `INV-${idx + 1}`);
    row.getCell(3).value = formatExcelDate(inv.date);
    row.getCell(4).value = inv.category || 'مصروفات';
    row.getCell(5).value = itemsSummary || '-';
    row.getCell(6).value = (inv.items || []).length || 1;
    row.getCell(7).value = amt;
    row.getCell(8).value = inv.notes || '';

    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
      cell.alignment = { 
        horizontal: (c === 4 || c === 5 || c === 8) ? 'right' : 'center', 
        vertical: 'middle' 
      };
      if (c === 7) cell.numFmt = '#,##0 "ج.م"';
    }
    currentRow++;
  });

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 26;
  sheet.mergeCells(currentRow, 1, currentRow, 6);
  sumRow.getCell(1).value = `إجمالي الفواتير (${filtered.length} فاتورة)`;
  sumRow.getCell(7).value = totalSum;
  sumRow.getCell(8).value = '';

  for (let c = 1; c <= 8; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (c === 7) cell.numFmt = '#,##0 "ج.م"';
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 30;
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 18;
  sheet.getColumn(8).width = 24;
}

/**
 * SHEET 6: الموظفين
 */
function buildEmployeesSheet(workbook, employees = [], attendance = [], advances = [], month, year) {
  const sheet = workbook.addWorksheet('الموظفين');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;

  sheet.mergeCells(1, 1, 1, 9);
  const banner = sheet.getCell(1, 1);
  banner.value = `كشف بيانات الموظفين وإحصائيات الحضور والسلف — ${monthName}`;
  banner.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.white } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerNavy } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const headers = ['م', 'اسم الموظف', 'الوظيفة / الدور', 'التخصص', 'الحالة', 'أيام الحضور', 'أيام الغياب', 'أيام الإجازة', 'إجمالي السلف (جنيه)'];
  const hRow = sheet.getRow(2);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  const mNum = (month === 'all' || month === 'ALL') ? null : Number(month);
  const yNum = Number(year) || new Date().getFullYear();

  let currentRow = 3;
  let totalPresentSum = 0;
  let totalAdvancesSum = 0;

  const roleLabels = {
    doctor: 'طبيب / دكتور',
    nurse: 'تمريض',
    supervisor: 'مشرف',
    worker: 'عامل'
  };

  employees.forEach((emp, idx) => {
    const row = sheet.getRow(currentRow);
    row.height = 22;
    const empId = String(emp._id || emp.id || '');

    const empAtt = attendance.filter(a => {
      const aEmpId = String(a.employeeId?._id || a.employeeId || '');
      if (aEmpId !== empId) return false;
      if (!a.date) return false;
      const ad = new Date(a.date);
      if (mNum && (ad.getMonth() + 1) !== mNum) return false;
      if (ad.getFullYear() !== yNum) return false;
      return true;
    });

    const presentCount = empAtt.filter(a => a.status === 'present').length;
    const absentCount = empAtt.filter(a => a.status === 'absent').length;
    const leaveCount = empAtt.filter(a => a.status === 'leave').length;

    const empAdv = advances.filter(a => {
      const aEmpId = String(a.employeeId?._id || a.employeeId || '');
      if (aEmpId !== empId && a.employeeName !== emp.name) return false;
      if (!a.date) return false;
      const ad = new Date(a.date);
      if (mNum && (ad.getMonth() + 1) !== mNum) return false;
      if (ad.getFullYear() !== yNum) return false;
      return true;
    });

    const advTotal = empAdv.reduce((s, a) => s + (Number(a.amount) || 0), 0);

    totalPresentSum += presentCount;
    totalAdvancesSum += advTotal;

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = emp.name;
    row.getCell(3).value = roleLabels[emp.role] || emp.role || emp.type || '-';
    row.getCell(4).value = emp.specialization || '-';
    row.getCell(5).value = emp.status === 'active' ? 'نشط' : 'معطل';
    row.getCell(6).value = presentCount;
    row.getCell(7).value = absentCount;
    row.getCell(8).value = leaveCount;
    row.getCell(9).value = advTotal;

    for (let c = 1; c <= 9; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
      cell.alignment = { 
        horizontal: (c === 2 || c === 4) ? 'right' : 'center', 
        vertical: 'middle' 
      };
      if (c === 9) cell.numFmt = '#,##0 "ج.م"';
    }

    currentRow++;
  });

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 26;
  sheet.mergeCells(currentRow, 1, currentRow, 5);
  sumRow.getCell(1).value = `إجمالي الكادر (${employees.length} موظف)`;
  sumRow.getCell(6).value = totalPresentSum;
  sumRow.getCell(7).value = '';
  sumRow.getCell(8).value = '';
  sumRow.getCell(9).value = totalAdvancesSum;

  for (let c = 1; c <= 9; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (c === 9) cell.numFmt = '#,##0 "ج.م"';
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 14;
  sheet.getColumn(9).width = 20;
}

/**
 * SHEET 7: السلف
 */
function buildAdvancesSheet(workbook, advances = [], month, year) {
  const sheet = workbook.addWorksheet('السلف');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;

  sheet.mergeCells(1, 1, 1, 6);
  const banner = sheet.getCell(1, 1);
  banner.value = `كشف حركة سلف الموظفين — ${monthName}`;
  banner.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.white } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerNavy } };
  banner.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const headers = ['م', 'التاريخ', 'اسم الموظف', 'الوظيفة / الدور', 'قيمة السلفة', 'ملاحظات / سبب السلفة'];
  const hRow = sheet.getRow(2);
  hRow.height = 26;
  headers.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  const mNum = (month === 'all' || month === 'ALL') ? null : Number(month);
  const yNum = Number(year) || new Date().getFullYear();

  const filtered = advances.filter(adv => {
    if (!adv.date) return false;
    const ad = new Date(adv.date);
    if (mNum && (ad.getMonth() + 1) !== mNum) return false;
    if (ad.getFullYear() !== yNum) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

  let currentRow = 3;
  let totalAdvances = 0;

  filtered.forEach((adv, idx) => {
    const row = sheet.getRow(currentRow);
    row.height = 22;
    const amt = Number(adv.amount || 0);
    totalAdvances += amt;

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = formatExcelDate(adv.date);
    row.getCell(3).value = adv.employeeName || adv.employeeId?.name || 'موظف';
    row.getCell(4).value = adv.role || adv.employeeId?.role || '-';
    row.getCell(5).value = amt;
    row.getCell(6).value = adv.notes || '';

    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN;
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
      cell.alignment = { 
        horizontal: (c === 3 || c === 6) ? 'right' : 'center', 
        vertical: 'middle' 
      };
      if (c === 5) cell.numFmt = '#,##0 "ج.م"';
    }
    currentRow++;
  });

  const sumRow = sheet.getRow(currentRow);
  sumRow.height = 26;
  sheet.mergeCells(currentRow, 1, currentRow, 4);
  sumRow.getCell(1).value = `إجمالي السلف (${filtered.length} سلفة)`;
  sumRow.getCell(5).value = totalAdvances;
  sumRow.getCell(6).value = '';

  for (let c = 1; c <= 6; c++) {
    const cell = sumRow.getCell(c);
    cell.border = BORDER_DOUBLE_BOTTOM;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (c === 5) cell.numFmt = '#,##0 "ج.م"';
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 24;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 18;
  sheet.getColumn(6).width = 30;
}

/**
 * SHEET 8: ملخص الايرادات والمصاريف (Matching Image 5)
 */
function buildSummarySheet(workbook, { totalRevenue, totalExpenses, previousSettlement = 0 }, month, year) {
  const sheet = workbook.addWorksheet('ملخص الايرادات والمصاريف');
  sheet.views = [{ rtl: true, showGridLines: true }];

  const monthName = (month === 'all' || month === 'ALL') ? `عام ${year}` : `${getArabicMonthName(month)} ${year}`;
  const netAmount = (totalRevenue || 0) - (totalExpenses || 0);

  sheet.mergeCells(2, 3, 2, 5);
  const titleCell = sheet.getCell(2, 3);
  titleCell.value = `ملخص الايرادات والمصاريف لشهر ${monthName}`;
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.black } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bannerGreen } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 36;

  sheet.getCell(3, 3).value = 'الايرادات';
  sheet.getCell(3, 4).value = 'المصاريف';
  sheet.getCell(3, 5).value = 'تصفية الشهر السابق';
  sheet.getRow(3).height = 32;

  sheet.getCell(3, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.softPeach } };
  sheet.getCell(3, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.softPeach } };
  sheet.getCell(3, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brightYellow } };

  [3, 4, 5].forEach(c => {
    const cell = sheet.getCell(3, c);
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 13, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  sheet.getCell(4, 3).value = totalRevenue || 0;
  sheet.getCell(4, 4).value = totalExpenses || 0;
  sheet.getCell(4, 5).value = previousSettlement || 0;
  sheet.getRow(4).height = 36;

  [3, 4, 5].forEach(c => {
    const cell = sheet.getCell(4, c);
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 14, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.numFmt = '#,##0';
  });

  // Net = الايرادات (C4) - المصاريف (D4)
  sheet.mergeCells(5, 3, 5, 4);
  const netCell = sheet.getCell(5, 3);
  netCell.value = {
    formula: 'C4-D4',
    result: netAmount
  };
  netCell.font = { name: 'Arial', size: 20, bold: true, color: { argb: COLORS.black } };
  netCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlueTotal } };
  netCell.alignment = { horizontal: 'center', vertical: 'middle' };
  netCell.border = BORDER_THIN;
  netCell.numFmt = '#,##0;-#,##0;0';

  sheet.getCell(5, 5).border = BORDER_THIN;
  sheet.getRow(5).height = 48;

  sheet.getCell(2, 7).value = 'ملاحظات / تسويات';
  sheet.mergeCells(2, 7, 2, 9);
  sheet.getCell(2, 7).font = { name: 'Arial', size: 11, bold: true, color: { argb: COLORS.black } };
  sheet.getCell(2, 7).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell(2, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.getCell(2, 7).border = BORDER_THIN;

  sheet.getCell(3, 7).value = 'التاريخ';
  sheet.getCell(3, 8).value = 'البيان / ملاحظات';
  sheet.getCell(3, 9).value = 'المبلغ';
  sheet.getCell(3, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.getCell(3, 8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.getCell(3, 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  [7, 8, 9].forEach(c => {
    const cell = sheet.getCell(3, c);
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  sheet.getCell(4, 7).value = `01/${String(month === 'all' || month === 'ALL' ? 10 : month).padStart(2, '0')}/${year}`;
  sheet.getCell(4, 8).value = 'تسوية ورصيد الشهر السابق';
  sheet.getCell(4, 9).value = previousSettlement || 0;
  [7, 8, 9].forEach(c => {
    const cell = sheet.getCell(4, c);
    cell.border = BORDER_THIN;
    cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.black } };
    cell.alignment = { horizontal: c === 8 ? 'right' : 'center', vertical: 'middle' };
    if (c === 9) cell.numFmt = '#,##0';
  });

  sheet.getColumn(1).width = 4;
  sheet.getColumn(2).width = 4;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 22;
  sheet.getColumn(6).width = 6;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 30;
  sheet.getColumn(9).width = 16;
}

const generateMonthlyExcelReport = async ({
  month,
  year,
  branchName,
  summary = {},
  transactions = [],
  patients = [],
  attendance = [],
  advances = [],
  invoices = [],
  employees = [],
  branchComparison = [],
  previousSettlement = 0
}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clinic Management System';
  workbook.created = new Date();

  // 1. Sheet: نزلاء (Image 1)
  buildPatientsSheet(workbook, patients, month, year, branchName);

  // 2. Sheet: الدكاترة والتمريض (Image 2)
  buildDoctorsAttendanceSheet(workbook, employees, attendance, advances, month, year);

  // 3. Sheet: المشرفيين والعمال (Image 3)
  buildStaffAttendanceSheet(workbook, employees, attendance, advances, month, year);

  // 4. Sheet: مصاريف يومية (Image 4)
  buildDailyExpensesSheet(workbook, invoices, transactions, month, year);

  // 5. Sheet: فواتير
  buildInvoicesSheet(workbook, invoices, month, year);

  // 6. Sheet: الموظفين
  buildEmployeesSheet(workbook, employees, attendance, advances, month, year);

  // 7. Sheet: السلف
  buildAdvancesSheet(workbook, advances, month, year);

  // 8. Sheet: ملخص الايرادات والمصاريف (Image 5)
  buildSummarySheet(workbook, {
    totalRevenue: summary.totalIncome || 0,
    totalExpenses: summary.totalExpenses || 0,
    previousSettlement: Number(previousSettlement || 0)
  }, month, year);

  return workbook;
};

module.exports = { generateMonthlyExcelReport };
