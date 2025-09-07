const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Authenticate JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Require specific role(s)
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// Ensure user belongs to same college (for college-specific operations)
const requireSameCollege = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // For admin operations, verify admin exists and is active
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      const [admin] = await db.execute(
        'SELECT college_id, is_active FROM admins WHERE id = ?',
        [req.user.id]
      );

      if (admin.length === 0 || !admin[0].is_active) {
        return res.status(403).json({ error: 'Admin account not found or inactive' });
      }

      req.user.college_id = admin[0].college_id;
    }

    // For student operations, verify student exists and is active
    if (req.user.role === 'student') {
      const [student] = await db.execute(
        'SELECT college_id, is_active FROM students WHERE id = ?',
        [req.user.id]
      );

      if (student.length === 0 || !student[0].is_active) {
        return res.status(403).json({ error: 'Student account not found or inactive' });
      }

      req.user.college_id = student[0].college_id;
    }

    next();
  } catch (error) {
    console.error('Error in requireSameCollege middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireSameCollege
};
