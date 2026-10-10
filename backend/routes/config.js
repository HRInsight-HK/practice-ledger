const express = require('express');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { sendText } = require('../lib/wecom-bot');

const router = express.Router();

// 默认职位→企微UserID映射（数据库未配置时的兜底，与原环境变量一致）
const DEFAULT_PERSONNEL = {
  hrName: 'Zoe（SSC）',
  hrUserId: 'ZhongYi',
  managerName: 'massie（HRD）',
  managerUserId: 'JiangHanLing',
  adminName: '莫青霖（行政）',
  adminUserId: 'MoQingLing',
  updatedAt: ''
};

function getPersonnel() {
  const data = getData();
  return Object.assign({}, DEFAULT_PERSONNEL, data.personnelConfig || {});
}

// 读取人员配置（需登录）
router.get('/', authMiddleware, (req, res) => {
  res.json({ personnelConfig: getPersonnel() });
});

// 更新人员配置（HR/HRD 可改）
router.put('/', authMiddleware, requireRole('hr', 'manager'), async (req, res) => {
  const data = getData();
  const allowed = ['hrName', 'hrUserId', 'managerName', 'managerUserId', 'adminName', 'adminUserId'];
  const update = {};
  allowed.forEach(k => {
    if (typeof req.body[k] === 'string') update[k] = req.body[k].trim();
  });
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }
  data.personnelConfig = Object.assign(getPersonnel(), update, { updatedAt: new Date().toISOString() });
  await saveData();
  res.json({ success: true, personnelConfig: data.personnelConfig });
});

// 发送测试通知，验证 UserID 是否配置正确
router.post('/test', authMiddleware, requireRole('hr', 'manager'), async (req, res) => {
  const target = req.body.target; // 'hr' | 'manager' | 'admin' | 'all'
  const p = getPersonnel();
  let mentioned;
  let label;
  if (target === 'hr') { mentioned = p.hrUserId ? [p.hrUserId] : []; label = 'SSC(' + p.hrName + ')'; }
  else if (target === 'manager') { mentioned = p.managerUserId ? [p.managerUserId] : []; label = 'HRD(' + p.managerName + ')'; }
  else if (target === 'admin') { mentioned = p.adminUserId ? [p.adminUserId] : []; label = '行政(' + p.adminName + ')'; }
  else if (target === 'all') { mentioned = ['@all']; label = '全员'; }
  else { return res.status(400).json({ error: 'target 必须是 hr/manager/admin/all' }); }

  try {
    sendText('【实操系统测试通知】这是一条人员配置测试消息，@配置生效验证。', mentioned);
    res.json({ success: true, target: label, mentioned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
