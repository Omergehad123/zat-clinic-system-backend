const AuditLog = require('../models/AuditLog');

// GET /api/audit-logs
const getAuditLogs = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };

    if (req.query.entity) {
      filter.entity = req.query.entity;
    }
    if (req.query.action) {
      filter.action = req.query.action;
    }

    const logs = await AuditLog.find(filter)
      .populate('userId', 'name email role')
      .populate('branchId', 'name')
      .sort({ timestamp: -1 })
      .limit(200);

    const formatted = logs.map(l => ({
      id: l._id.toString(),
      _id: l._id.toString(),
      userId: l.userId ? (l.userId._id || l.userId).toString() : null,
      userName: l.userId ? l.userId.name : 'النظام',
      userEmail: l.userId ? l.userId.email : '',
      userRole: l.userId ? l.userId.role : '',
      action: l.action,
      entity: l.entity,
      entityId: l.entityId ? l.entityId.toString() : null,
      branchId: l.branchId ? (l.branchId._id || l.branchId).toString() : null,
      branchName: l.branchId ? l.branchId.name : '',
      timestamp: l.timestamp,
      metadata: l.metadata
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAuditLogs };
