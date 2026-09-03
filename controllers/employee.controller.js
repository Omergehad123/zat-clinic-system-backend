const Employee = require('../models/Employee');
const { logAudit } = require('../utils/audit.utils');

// GET /api/employees
const getEmployees = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };
    const queryRole = req.query.role || req.query.type;
    
    if (queryRole && queryRole !== 'ALL') {
      let roleKey = queryRole;
      if (queryRole === 'دكتور' || queryRole === 'طبيب') roleKey = 'doctor';
      else if (queryRole === 'تمريض') roleKey = 'nurse';
      else if (queryRole === 'مشرف') roleKey = 'supervisor';
      else if (queryRole === 'عامل') roleKey = 'worker';
      filter.role = roleKey;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const employees = await Employee.find(filter).populate('branchId', 'name').sort({ createdAt: -1 });

    const formatted = employees.map(e => {
      let typeAr = 'دكتور';
      if (e.role === 'nurse') typeAr = 'تمريض';
      else if (e.role === 'supervisor') typeAr = 'مشرف';
      else if (e.role === 'worker') typeAr = 'عامل';

      return {
        id: e._id.toString(),
        _id: e._id.toString(),
        name: e.name,
        role: e.role,
        type: typeAr,
        specialization: e.specialization || '-',
        branchId: e.branchId ? (e.branchId._id || e.branchId).toString() : null,
        branchName: e.branchId ? e.branchId.name : 'غير محدد',
        status: e.status === 'active' ? 'نشط' : 'معطل',
        createdAt: e.createdAt
      };
    });

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/employees
const createEmployee = async (req, res, next) => {
  try {
    const { name, role, type, specialization, status, branchId } = req.body;

    const targetBranchId = req.user.role === 'super_admin' ? (branchId || req.body.branchId) : req.user.branchId;

    if (!name) {
      return res.status(400).json({ success: false, message: 'اسم الموظف مطلوب' });
    }

    const rawRole = role || type || 'doctor';
    let finalRole = 'doctor';
    let typeAr = 'دكتور';

    if (rawRole === 'doctor' || rawRole === 'دكتور' || rawRole === 'طبيب') {
      finalRole = 'doctor';
      typeAr = 'دكتور';
    } else if (rawRole === 'nurse' || rawRole === 'تمريض') {
      finalRole = 'nurse';
      typeAr = 'تمريض';
    } else if (rawRole === 'supervisor' || rawRole === 'مشرف') {
      finalRole = 'supervisor';
      typeAr = 'مشرف';
    } else if (rawRole === 'worker' || rawRole === 'عامل') {
      finalRole = 'worker';
      typeAr = 'عامل';
    }

    const employee = await Employee.create({
      name,
      role: finalRole,
      specialization: finalRole === 'doctor' ? (specialization || 'عام') : (specialization || null),
      branchId: targetBranchId,
      status: status || 'active'
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_EMPLOYEE',
      entity: 'Employee',
      entityId: employee._id,
      branchId: employee.branchId,
      metadata: { name: employee.name, role: employee.role }
    });

    res.status(201).json({
      success: true,
      data: {
        id: employee._id.toString(),
        _id: employee._id.toString(),
        name: employee.name,
        role: employee.role,
        type: typeAr,
        specialization: employee.specialization,
        branchId: employee.branchId ? employee.branchId.toString() : null,
        status: employee.status === 'active' ? 'نشط' : 'معطل'
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/employees/:id
const updateEmployee = async (req, res, next) => {
  try {
    const { name, role, specialization, status } = req.body;
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    }

    if (req.user.role !== 'super_admin' && employee.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل موظف لفرع آخر' });
    }

    if (name) employee.name = name;
    if (role) {
      employee.role = role;
      if (role === 'doctor' && !specialization && !employee.specialization) {
        return res.status(400).json({ success: false, message: 'التخصص مطلوب للأطباء' });
      }
    }
    if (specialization !== undefined) employee.specialization = specialization;
    if (status) employee.status = status;

    await employee.save();

    await logAudit({
      user: req.user,
      action: 'UPDATE_EMPLOYEE',
      entity: 'Employee',
      entityId: employee._id,
      branchId: employee.branchId
    });

    res.json({
      success: true,
      data: {
        id: employee._id.toString(),
        _id: employee._id.toString(),
        name: employee.name,
        role: employee.role,
        specialization: employee.specialization,
        branchId: employee.branchId.toString(),
        status: employee.status
      }
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/employees/:id (Deactivate)
const deleteEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    }

    if (req.user.role !== 'super_admin' && employee.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعطيل موظف لفرع آخر' });
    }

    employee.status = 'inactive';
    await employee.save();

    await logAudit({
      user: req.user,
      action: 'DEACTIVATE_EMPLOYEE',
      entity: 'Employee',
      entityId: employee._id,
      branchId: employee.branchId
    });

    res.json({ success: true, message: 'تم تعطيل حساب الموظف بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getEmployees, createEmployee, updateEmployee, deleteEmployee };
