const jwt = require('jsonwebtoken');
const { User, ROLES } = require('../models/user.model');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error();
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new Error();
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'Please authenticate'
      }
    });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'Admin access required'
      }
    });
  }
  next();
};

const isEditor = (req, res, next) => {
  if (![ROLES.ADMIN, ROLES.EDITOR].includes(req.user.role)) {
    return res.status(403).json({
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'Editor access required'
      }
    });
  }
  next();
};

const isViewer = (req, res, next) => {
  if (![ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER].includes(req.user.role)) {
    return res.status(403).json({
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'Viewer access required'
      }
    });
  }
  next();
};

module.exports = {
  auth,
  isAdmin,
  isEditor,
  isViewer
}; 