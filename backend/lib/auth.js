const jwt = require('jsonwebtoken');
const { getData } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'practice_ledger_secret_2026_dev';
const JWT_EXPIRES = '8h';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const accounts = getData().accounts;
    const user = accounts.find(a => a.id === decoded.id && a.active);
    if (!user) return res.status(401).json({ error: '账号已停用' });
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      wecom: user.wecom
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限执行此操作' });
    }
    next();
  };
}

module.exports = { generateToken, authMiddleware, requireRole, JWT_SECRET };
