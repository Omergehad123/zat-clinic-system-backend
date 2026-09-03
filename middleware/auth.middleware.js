const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');

      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return res.status(401).json({ success: false, message: 'المستخدم غير موجود' });
      }

      if (user.status === 'inactive') {
        return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error(error);
      return res.status(401).json({ success: false, message: 'رمز التفويض غير صالح أو منتهي الصلاحية' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'يرجى تسجيل الدخول للوصول إلى هذا المورد' });
  }
};

module.exports = { protect };
