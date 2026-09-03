const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'غير مصرح' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `دور المستخدم (${req.user.role}) لا يملك الصلاحية للوصول لهذا الإجراء`
      });
    }

    next();
  };
};

// Branch isolation middleware
const branchIsolation = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }

  // Super Admin can access all or filter by branchId query/body
  if (req.user.role === 'super_admin') {
    const requestedBranch = req.query.branchId || req.body.branchId;
    if (requestedBranch && requestedBranch !== 'all') {
      req.branchFilter = { branchId: requestedBranch };
      req.effectiveBranchId = requestedBranch;
    } else {
      req.branchFilter = {};
      req.effectiveBranchId = null;
    }
  } else {
    // Non super admin is strictly constrained to their user's assigned branch
    if (!req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'المستخدم غير معين لأي فرع'
      });
    }

    const userBranchStr = req.user.branchId.toString();

    // Automatically enforce req.user.branchId for all non-super_admin mutations and queries
    req.body.branchId = userBranchStr;
    req.branchFilter = { branchId: req.user.branchId };
    req.effectiveBranchId = userBranchStr;
  }

  next();
};

module.exports = { authorize, branchIsolation };
