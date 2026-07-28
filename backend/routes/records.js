const express = require('express');
const path = require('path');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { notifyFeedbackSubmitted, notifyRecordCreated, notifyOnboarding } = require('../lib/wecom-bot');

const router = express.Router();

// Multer config for attachment uploads
const multer = require('multer');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, 'feedback_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: function (req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.bmp', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持图片和PDF'));
    }
  }
});

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + parseInt(days));
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(d1, d2) {
  const diff = new Date(d2) - new Date(d1);
  return Math.round(diff / 86400000);
}

function genToken() {
  return require('crypto').randomBytes(12).toString('hex');
}

const MAX_PRACTICE_DAYS = 7;

function filterRecord(r, role) {
  const base = {
    id: r.id,
    name: r.name,
    mentor: r.mentor,
    dept1: r.dept1 || '',
    dept2: r.dept2 || '',
    startDate: r.startDate,
    practiceDays: r.practiceDays,
    endDate: r.endDate,
    deviceModel: r.deviceModel || '',
    accessories: r.accessories || '',
    serialNumber: r.serialNumber || '',
    remark: r.remark || '',
    status: r.status,
    hasFeedback: !!r.feedback,
    hasSettlement: !!r.settlement,
    hasOnboarding: !!r.onboarding,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };

  if (role === 'admin') {
    return base;
  }

  const full = {
    ...base,
    feedback: r.feedback || null,
    settlement: r.settlement || null,
    onboarding: r.onboarding || null,
    feedbackToken: r.feedbackToken || ''
  };

  // Include attachment URL if exists
  if (r.feedback && r.feedback.attachmentName) {
    full.feedback.attachmentUrl = '/uploads/' + r.feedback.attachmentName;
  }

  return full;
}

router.get('/', authMiddleware, (req, res) => {
  const records = getData().records;
  const filtered = records.map(r => filterRecord(r, req.user.role));
  res.json({ records: filtered });
});

router.post('/', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  const { name, mentor, dept1, dept2, startDate, practiceDays, deviceModel, accessories, serialNumber, remark } = req.body;
  if (!name) return res.status(400).json({ error: '请填写实操人员姓名' });
  if (!mentor) return res.status(400).json({ error: '请填写带教人' });
  if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!practiceDays || practiceDays < 1) return res.status(400).json({ error: '请填写有效的实操天数' });
  if (!startDate) return res.status(400).json({ error: '请选择实操开始日期' });

  const endDate = addDays(startDate, practiceDays);
  const today = todayStr();
  let status = 'practicing';
  if (endDate <= today) status = 'feedback_pending';

  const data = getData();
  const record = {
    id: 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    mentor,
    dept1,
    dept2: dept2 || '',
    startDate,
    practiceDays: parseInt(practiceDays),
    endDate,
    deviceModel: deviceModel || '',
    accessories: accessories || '',
    serialNumber: serialNumber || '',
    remark: remark || '',
    status,
    feedback: null,
    settlement: null,
    onboarding: null,
    feedbackToken: genToken(),
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.records.push(record);
  saveData();

  notifyRecordCreated(record);

  const warning = parseInt(practiceDays) > MAX_PRACTICE_DAYS
    ? ' 实操天数超过' + MAX_PRACTICE_DAYS + '天建议上限，已发送用工风险预警'
    : '';

  res.json({ success: true, record: filterRecord(record, req.user.role), warning });
});

router.put('/:id', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  const { name, mentor, dept1, dept2, startDate, practiceDays, deviceModel, accessories, serialNumber, remark } = req.body;
  if (name !== undefined) r.name = name;
  if (mentor !== undefined) r.mentor = mentor;
  if (dept1 !== undefined) r.dept1 = dept1;
  if (dept2 !== undefined) r.dept2 = dept2;
  if (startDate !== undefined) r.startDate = startDate;
  if (practiceDays !== undefined) {
    r.practiceDays = parseInt(practiceDays);
    r.endDate = addDays(r.startDate, r.practiceDays);
    if (r.status === 'practicing' && r.endDate <= todayStr()) r.status = 'feedback_pending';
  }
  if (deviceModel !== undefined) r.deviceModel = deviceModel;
  if (accessories !== undefined) r.accessories = accessories;
  if (serialNumber !== undefined) r.serialNumber = serialNumber;
  if (remark !== undefined) r.remark = remark;
  r.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

router.delete('/:id', authMiddleware, requireRole('hr', 'manager'), (req, res) => {
  const data = getData();
  const idx = data.records.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '记录不存在' });
  data.records.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

// ==================== 组长公开反馈表单（免登录，token鉴权） ====================
router.get('/feedback-form/:token', (req, res) => {
  const data = getData();
  const r = data.records.find(x => x.feedbackToken === req.params.token);
  if (!r) return res.status(404).json({ error: '反馈链接无效或已过期' });

  res.json({
    id: r.id,
    name: r.name,
    mentor: r.mentor,
    startDate: r.startDate,
    endDate: r.endDate,
    practiceDays: r.practiceDays,
    status: r.status,
    hasFeedback: !!r.feedback
  });
});

// 公开反馈提交 - 支持附件上传
router.post('/feedback-form/:token', upload.single('attachment'), (req, res) => {
  const { result, note, attendanceDays, lateCount, earlyLeaveCount } = req.body;
  if (!result || !['pass', 'fail'].includes(result)) {
    return res.status(400).json({ error: '请选择反馈结果' });
  }

  const data = getData();
  const r = data.records.find(x => x.feedbackToken === req.params.token);
  if (!r) return res.status(404).json({ error: '反馈链接无效' });
  if (r.feedback) return res.status(400).json({ error: '该人员反馈已提交，不可重复填写' });

  r.feedback = {
    result,
    note: note || '',
    attendanceDays: parseInt(attendanceDays) || r.practiceDays,
    lateCount: parseInt(lateCount) || 0,
    earlyLeaveCount: parseInt(earlyLeaveCount) || 0,
    date: todayStr(),
    by: r.mentor,
    source: 'mentor_form',
    attachmentName: req.file ? req.file.filename : '',
    attachmentOriginalName: req.file ? req.file.originalname : ''
  };
  r.status = 'feedback_done';
  r.updatedAt = new Date().toISOString();
  saveData();

  notifyFeedbackSubmitted(r);

  res.json({ success: true, message: '反馈已提交，人事将尽快处理' });
});

// ==================== HR代录反馈 - 支持附件上传 ====================
router.post('/:id/feedback', authMiddleware, requireRole('hr'), upload.single('attachment'), (req, res) => {
  const { result, note, attendanceDays, lateCount, earlyLeaveCount } = req.body;
  if (!result || !['pass', 'fail'].includes(result)) {
    return res.status(400).json({ error: '请选择反馈结果' });
  }

  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  r.feedback = {
    result,
    note: note || '',
    attendanceDays: parseInt(attendanceDays) || r.practiceDays,
    lateCount: parseInt(lateCount) || 0,
    earlyLeaveCount: parseInt(earlyLeaveCount) || 0,
    date: todayStr(),
    by: req.user.username,
    source: 'hr_manual',
    attachmentName: req.file ? req.file.filename : '',
    attachmentOriginalName: req.file ? req.file.originalname : ''
  };
  r.status = 'feedback_done';
  r.updatedAt = new Date().toISOString();
  saveData();

  notifyFeedbackSubmitted(r);

  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

// ==================== 办理结算（HR）- 不存金额，金额在本地 ====================
router.post('/:id/settlement', authMiddleware, requireRole('hr'), (req, res) => {
  const { date, note } = req.body;
  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  r.settlement = {
    date: date || todayStr(),
    note: note || '',
    by: req.user.username
  };
  r.status = 'settled';
  r.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

// ==================== 办理入职（HR）- 通知@massie和@Zoe ====================
router.post('/:id/onboarding', authMiddleware, requireRole('hr'), (req, res) => {
  const { date, note } = req.body;
  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  const onboardDate = date || todayStr();
  r.onboarding = {
    date: onboardDate,
    note: note || '',
    by: req.user.username,
    daysToOnboard: r.feedback ? daysBetween(r.endDate, onboardDate) : 0
  };
  r.status = 'onboarded';
  r.updatedAt = new Date().toISOString();
  saveData();

  // 通知 @massie 和 @Zoe 办理入职
  notifyOnboarding(r);

  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

module.exports = router;
