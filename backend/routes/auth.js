const express = require('express');
const { getData, saveData, hashPassword, verifyPassword } = require('../lib/db');
const { generateToken, authMiddleware, requireRole } = require('../lib/auth');

const router = express.Router();

// ==================== 登录 ====================
router.post('/login', (req, res) => {
  const { username, password, deviceModel, accessories, serialNumber } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  const data = getData();
  const acc = data.accounts.find(a => a.username === username && a.active);
  if (!acc || !verifyPassword(password, acc.password)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  // 记录登录日志
  data.loginLogs.push({
    id: 'L' + Date.now().toString(36),
    username: acc.username,
    name: acc.name,
    role: acc.role,
    wecom: acc.wecom || '',
    deviceModel: deviceModel || '',
    accessories: accessories || '',
    serialNumber: serialNumber || '',
    ip: req.ip || (req.connection && req.connection.remoteAddress) || '',
    loginTime: new Date().toISOString()
  });
  // 只保留最近 500 条日志
  if (data.loginLogs.length > 500) {
    data.loginLogs = data.loginLogs.slice(-500);
  }
  saveData();

  const token = generateToken(acc);
  res.json({
    token,
    user: {
      id: acc.id,
      username: acc.username,
      name: acc.name,
      role: acc.role,
      wecom: acc.wecom
    }
  });
});

// ==================== 当前用户信息 ====================
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ==================== 账号管理 ====================
router.get('/accounts', authMiddleware, requireRole('hr', 'manager'), (req, res) => {
  const accounts = getData().accounts.map(a => ({
    id: a.id,
    username: a.username,
    name: a.name,
    wecom: a.wecom,
    role: a.role,
    active: a.active,
    createdAt: a.createdAt
  }));
  res.json({ accounts });
});

router.post('/accounts', authMiddleware, requireRole('hr', 'manager'), (req, res) => {
  const { username, password, name, wecom, role } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: '用户名、密码、姓名必填' });
  }
  if (!['admin', 'hr', 'manager'].includes(role)) {
    return res.status(400).json({ error: '角色无效' });
  }

  // HR 只能创建行政账号
  if (req.user.role === 'hr' && role !== 'admin') {
    return res.status(403).json({ error: 'HR 只能创建行政账号' });
  }

  const data = getData();
  if (data.accounts.find(a => a.username === username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const acc = {
    id: 'A' + Date.now().toString(36),
    username,
    password: hashPassword(password),
    name,
    wecom: wecom || '',
    role,
    active: true,
    createdAt: new Date().toISOString()
  };
  data.accounts.push(acc);
  saveData();
  res.json({ success: true, account: { ...acc, password: undefined } });
});

router.put('/accounts/:id', authMiddleware, requireRole('manager'), (req, res) => {
  const { name, wecom, role, active, password } = req.body;
  const data = getData();
  const acc = data.accounts.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: '账号不存在' });

  if (name !== undefined) acc.name = name;
  if (wecom !== undefined) acc.wecom = wecom;
  if (role && ['admin', 'hr', 'manager'].includes(role)) acc.role = role;
  if (active !== undefined) acc.active = active;
  if (password) acc.password = hashPassword(password);
  saveData();
  res.json({ success: true });
});

router.delete('/accounts/:id', authMiddleware, requireRole('manager'), (req, res) => {
  const data = getData();
  const idx = data.accounts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '账号不存在' });
  if (data.accounts[idx].username === 'manager') {
    return res.status(400).json({ error: '不能删除管理员账号' });
  }
  data.accounts.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

// ==================== 登录日志 ====================
router.get('/logs', authMiddleware, requireRole('hr', 'manager'), (req, res) => {
  const logs = getData().loginLogs.slice().reverse().slice(0, 100);
  res.json({ logs });
});

module.exports = router;
