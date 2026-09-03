const AuditLog = require('../models/AuditLog');

const logAudit = async ({ user, action, entity, entityId, branchId, metadata = {} }) => {
  try {
    if (!user) return;
    await AuditLog.create({
      userId: user._id || user.id,
      action,
      entity,
      entityId: entityId || null,
      branchId: branchId || user.branchId || null,
      metadata
    });
  } catch (err) {
    console.error('Audit Logging Error:', err.message);
  }
};

module.exports = { logAudit };
