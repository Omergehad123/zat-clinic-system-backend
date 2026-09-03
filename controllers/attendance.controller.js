const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { logAudit } = require('../utils/audit.utils');

// GET /api/attendance
const getAttendance = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };

    if (req.query.employeeId) {
      filter.employeeId = req.query.employeeId;
    }

    if (req.query.date) {
      const startOfDay = new Date(req.query.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(req.query.date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    } else if (req.query.month && req.query.year) {
      const m = parseInt(req.query.month) - 1;
      const y = parseInt(req.query.year);
      const startOfMonth = new Date(y, m, 1);
      const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const attendanceRecords = await Attendance.find(filter)
      .populate('employeeId', 'name role specialization')
      .sort({ date: -1 });

    const formatted = attendanceRecords.map(a => ({
      id: a._id.toString(),
      _id: a._id.toString(),
      employeeId: a.employeeId ? (a.employeeId._id || a.employeeId).toString() : null,
      employeeName: a.employeeId ? a.employeeId.name : '',
      role: a.employeeId ? a.employeeId.role : '',
      branchId: a.branchId.toString(),
      date: a.date,
      status: a.status,
      notes: a.notes
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/attendance (Bulk or Single Record Create/Update)
const recordAttendance = async (req, res, next) => {
  try {
    const { records, date } = req.body;

    let itemsToProcess = [];

    if (Array.isArray(records)) {
      itemsToProcess = records;
    } else if (req.body.employeeId) {
      itemsToProcess = [
        {
          employeeId: req.body.employeeId,
          status: req.body.status,
          notes: req.body.notes,
          date: req.body.date || date
        }
      ];
    }

    if (!itemsToProcess.length) {
      return res.status(400).json({ success: false, message: 'لا يوجد بيانات للحضور' });
    }

    const processedResults = [];

    for (const item of itemsToProcess) {
      const employee = await Employee.findById(item.employeeId);
      if (!employee) continue;

      if (req.user.role !== 'super_admin' && employee.branchId.toString() !== req.user.branchId.toString()) {
        continue; // skip unauthorized employee
      }

      const recDate = new Date(item.date || date || Date.now());
      recDate.setHours(12, 0, 0, 0); // normalize date to noon to avoid timezone shift

      const startOfDay = new Date(recDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(recDate);
      endOfDay.setHours(23, 59, 59, 999);

      if (item.status === 'delete') {
        // Remove the record entirely to reset to "not recorded"
        await Attendance.findOneAndDelete({
          employeeId: employee._id,
          date: { $gte: startOfDay, $lte: endOfDay }
        });
        continue;
      }

      let record = await Attendance.findOne({
        employeeId: employee._id,
        date: { $gte: startOfDay, $lte: endOfDay }
      });

      if (record) {
        record.status = item.status || record.status;
        record.notes = item.notes !== undefined ? item.notes : record.notes;
        record.createdBy = req.user._id;
        await record.save();
      } else {
        record = await Attendance.create({
          employeeId: employee._id,
          branchId: employee.branchId,
          date: recDate,
          status: item.status || 'present',
          notes: item.notes || '',
          createdBy: req.user._id
        });
      }

      processedResults.push(record);
    }

    await logAudit({
      user: req.user,
      action: 'UPDATE_ATTENDANCE',
      entity: 'Attendance',
      metadata: { count: processedResults.length }
    });

    res.json({ success: true, count: processedResults.length, data: processedResults });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAttendance, recordAttendance };
