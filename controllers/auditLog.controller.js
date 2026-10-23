const AuditLog = require('../models/AuditLog');

// Map action codes to Arabic labels
const actionLabels = {
  CREATE_EMPLOYEE: 'إضافة موظف',
  UPDATE_EMPLOYEE: 'تعديل موظف',
  DELETE_EMPLOYEE: 'حذف موظف',
  CREATE_EMPLOYEE_ADVANCE: 'إضافة سلفة',
  UPDATE_EMPLOYEE_ADVANCE: 'تعديل سلفة',
  DELETE_EMPLOYEE_ADVANCE: 'حذف سلفة',
  UPDATE_ATTENDANCE: 'تسجيل حضور',
  DELETE_ATTENDANCE: 'حذف حضور',
  CREATE_PATIENT: 'إضافة نزيل',
  UPDATE_PATIENT: 'تعديل نزيل',
  DELETE_PATIENT: 'حذف نزيل',
  DISCHARGE_PATIENT: 'تسجيل خروج نزيل',
  RENEW_PATIENT: 'تجديد إقامة نزيل',
  ADD_PAYMENT: 'إضافة دفعة سداد',
  CREATE_PAYMENT: 'إضافة دفعة سداد',
  DELETE_PATIENT_PAYMENT: 'حذف دفعة سداد',
  ADD_PATIENT_EXPENSE: 'إضافة مصروف نزيل',
  CREATE_PATIENT_EXPENSE: 'إضافة مصروف نزيل',
  CREATE_EXPENSE: 'إضافة مصروف',
  UPDATE_EXPENSE: 'تعديل مصروف',
  DELETE_EXPENSE: 'حذف مصروف',
  CREATE_INVOICE: 'إضافة فاتورة',
  UPDATE_INVOICE: 'تعديل فاتورة',
  DELETE_INVOICE: 'حذف فاتورة',
  CREATE_BRANCH: 'إضافة فرع',
  UPDATE_BRANCH: 'تعديل فرع',
  DELETE_BRANCH: 'حذف فرع',
  TOGGLE_BRANCH_STATUS: 'تغيير حالة فرع',
  CREATE_USER: 'إضافة مستخدم',
  UPDATE_USER: 'تعديل مستخدم',
  DELETE_USER: 'حذف مستخدم',
  TOGGLE_USER_STATUS: 'تغيير حالة مستخدم',
  RESET_PASSWORD: 'إعادة تعيين كلمة المرور',
  LOGIN: 'تسجيل دخول',
  LOGOUT: 'تسجيل خروج',
};

const buildItemDescription = (action, entity, metadata) => {
  const m = metadata || {};
  const roleMap = { doctor: 'دكتور', nurse: 'تمريض', supervisor: 'مشرف', worker: 'عامل' };
  const statusMap = { present: 'حاضر', absent: 'غائب', leave: 'إجازة' };

  switch (action) {
    case 'CREATE_EMPLOYEE':
    case 'UPDATE_EMPLOYEE':
    case 'DELETE_EMPLOYEE':
      return m.name ? m.name + ' (' + (roleMap[m.role] || m.role || '') + ')' : (m.employeeName || entity);

    case 'CREATE_EMPLOYEE_ADVANCE':
    case 'UPDATE_EMPLOYEE_ADVANCE':
    case 'DELETE_EMPLOYEE_ADVANCE':
      return m.amount != null ? 'مبلغ ' + Number(m.amount).toLocaleString('ar-EG') + ' ج.م' : entity;

    case 'UPDATE_ATTENDANCE':
      if (m.count) return m.count + ' موظف';
      return entity;

    case 'DELETE_ATTENDANCE':
      return m.status ? 'حالة: ' + (statusMap[m.status] || m.status) : entity;

    case 'CREATE_PATIENT':
    case 'UPDATE_PATIENT':
    case 'DELETE_PATIENT':
    case 'DISCHARGE_PATIENT':
    case 'RENEW_PATIENT':
      return m.name || m.patientName || entity;

    case 'ADD_PAYMENT':
    case 'CREATE_PAYMENT':
    case 'DELETE_PATIENT_PAYMENT':
      if (m.patientName) {
        return (action === 'DELETE_PATIENT_PAYMENT' ? 'حذف دفعة: ' : '') + m.patientName + (m.amount != null ? ' — ' + Number(m.amount).toLocaleString('ar-EG') + ' ج.م' : '');
      }
      return m.amount != null ? 'دفعة بمبلغ ' + Number(m.amount).toLocaleString('ar-EG') + ' ج.م' : entity;

    case 'ADD_PATIENT_EXPENSE':
    case 'CREATE_PATIENT_EXPENSE':
      return m.patientName || entity;

    case 'CREATE_EXPENSE':
    case 'UPDATE_EXPENSE':
    case 'DELETE_EXPENSE':
      if (m.category) {
        return m.category + (m.totalAmount != null ? ' — ' + Number(m.totalAmount).toLocaleString('ar-EG') + ' ج.م' : '');
      }
      return entity;

    case 'CREATE_INVOICE':
    case 'UPDATE_INVOICE':
    case 'DELETE_INVOICE':
      if (m.category) {
        return m.category + (m.totalAmount != null ? ' — ' + Number(m.totalAmount).toLocaleString('ar-EG') + ' ج.م' : '');
      }
      return entity;

    case 'CREATE_BRANCH':
    case 'UPDATE_BRANCH':
    case 'DELETE_BRANCH':
    case 'TOGGLE_BRANCH_STATUS':
      return m.name || entity;

    case 'CREATE_USER':
    case 'UPDATE_USER':
    case 'DELETE_USER':
    case 'TOGGLE_USER_STATUS':
    case 'RESET_PASSWORD':
      return m.name || m.email || entity;

    default:
      return m.name || m.patientName || m.employeeName || entity || '-';
  }
};

// GET /api/audit-logs
const getAuditLogs = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };

    if (req.query.entity) filter.entity = req.query.entity;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.userId) filter.userId = req.query.userId;

    const logs = await AuditLog.find(filter)
      .populate('userId', 'name email role')
      .populate('branchId', 'name')
      .sort({ timestamp: -1 })
      .limit(200);

    const formatted = logs.map(l => {
      const meta = l.metadata || {};
      const actionLabel = actionLabels[l.action] || l.action;
      const itemDescription = buildItemDescription(l.action, l.entity, meta);

      const ts = l.timestamp || l.createdAt;
      const dateFormatted = ts
        ? new Date(ts).toLocaleString('ar-EG', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
          })
        : '-';

      return {
        id: l._id.toString(),
        _id: l._id.toString(),
        userId: l.userId ? (l.userId._id || l.userId).toString() : null,
        userName: l.userId ? l.userId.name : 'النظام',
        userEmail: l.userId ? l.userId.email : '',
        userRole: l.userId ? l.userId.role : '',
        action: actionLabel,
        actionCode: l.action,
        entity: l.entity,
        item: itemDescription,
        entityId: l.entityId ? l.entityId.toString() : null,
        branchId: l.branchId ? (l.branchId._id || l.branchId).toString() : null,
        branchName: l.branchId ? l.branchId.name : '',
        date: dateFormatted,
        timestamp: ts,
        metadata: l.metadata
      };
    });

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAuditLogs };
