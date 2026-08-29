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

// 简历上传：内存存储 + base64入库存（Render临时文件系统会丢失上传文件）
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: function (req, file, cb) {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF / Word / 图片 格式简历'));
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

// ==================== 联系方式 & 设备表格清洗 ====================
function sanitizeContact(c) {
  if (!c || typeof c !== 'object') return null;
  const contact = {
    phone: String(c.phone || '').trim(),
    wecom: String(c.wecom || '').trim(),
    wechat: String(c.wechat || '').trim()
  };
  return (contact.phone || contact.wecom || contact.wechat) ? contact : null;
}

function sanitizeDevices(list) {
  if (!Array.isArray(list)) return [];
  return list.map(d => ({
    alias: String((d && d.alias) || '').trim(),
    deviceModel: String((d && d.deviceModel) || '').trim(),
    brand: String((d && d.brand) || '').trim(),
    serialNumber: String((d && d.serialNumber) || '').trim(),
    wecomAccount: String((d && d.wecomAccount) || '').trim(),
    personalWechat: String((d && d.personalWechat) || '').trim(),
    otherAccounts: String((d && d.otherAccounts) || '').trim()
  })).filter(d => d.alias || d.deviceModel || d.brand || d.serialNumber || d.wecomAccount || d.personalWechat || d.otherAccounts);
}

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
    contact: r.contact || null,
    devices: r.devices || [],
    hasResume: !!(r.resume && r.resume.fileData),
    resumeOriginalName: r.resume ? (r.resume.originalName || '') : '',
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
    return { ...base, feedback: r.feedback || null, settlement: r.settlement || null, onboarding: r.onboarding || null, feedbackToken: r.feedbackToken || '' };
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

router.post('/', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const { name, mentor, dept1, dept2, startDate, practiceDays, deviceModel, accessories, serialNumber, remark, contact, devices } = req.body;
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
    contact: sanitizeContact(contact),
    devices: sanitizeDevices(devices),
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
  await saveData();

  notifyRecordCreated(record);

  const warning = parseInt(practiceDays) > MAX_PRACTICE_DAYS
    ? ' 实操天数超过' + MAX_PRACTICE_DAYS + '天建议上限，已发送用工风险预警'
    : '';

  res.json({ success: true, record: filterRecord(record, req.user.role), warning });
});

router.put('/:id', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  const { name, mentor, dept1, dept2, startDate, practiceDays, deviceModel, accessories, serialNumber, remark, contact, devices } = req.body;
  if (name !== undefined) r.name = name;
  if (mentor !== undefined) r.mentor = mentor;
  if (dept1 !== undefined) r.dept1 = dept1;
  if (dept2 !== undefined) r.dept2 = dept2;
  if (startDate !== undefined) r.startDate = startDate;
  if (practiceDays !== undefined) {
    r.practiceDays = parseInt(practiceDays);
  }
  // 日期或天数变化时，重新计算结束日期并更新状态
  if (startDate !== undefined || practiceDays !== undefined) {
    r.endDate = addDays(r.startDate, r.practiceDays);
    // 只在未反馈前自动更新状态（已有反馈的不动）
    if (r.status === 'practicing' || r.status === 'feedback_pending') {
      r.status = r.endDate <= todayStr() ? 'feedback_pending' : 'practicing';
    }
  }
  if (deviceModel !== undefined) r.deviceModel = deviceModel;
  if (accessories !== undefined) r.accessories = accessories;
  if (serialNumber !== undefined) r.serialNumber = serialNumber;
  if (contact !== undefined) r.contact = sanitizeContact(contact);
  if (devices !== undefined) r.devices = sanitizeDevices(devices);
  if (remark !== undefined) r.remark = remark;
  r.updatedAt = new Date().toISOString();
  await saveData();
  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

router.delete('/:id', authMiddleware, requireRole('admin', 'hr', 'manager'), async (req, res) => {
  const data = getData();
  const idx = data.records.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '记录不存在' });
  data.records.splice(idx, 1);
  await saveData();
  res.json({ success: true });
});

// ==================== SSC 上传/下载/删除 简历（base64入库存，防Render临时文件丢失） ====================
router.post('/:id/resume', authMiddleware, requireRole('hr', 'admin'), resumeUpload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择简历文件' });

  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });

  r.resume = {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    fileData: req.file.buffer.toString('base64'),
    uploadedBy: req.user.username,
    uploadedAt: new Date().toISOString()
  };
  r.updatedAt = new Date().toISOString();
  await saveData();
  res.json({ success: true, originalName: r.resume.originalName, uploadedAt: r.resume.uploadedAt });
});

router.get('/:id/resume', authMiddleware, (req, res) => {
  const r = getData().records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  if (!r.resume || !r.resume.fileData) return res.status(404).json({ error: '该人员尚未上传简历' });

  const buf = Buffer.from(r.resume.fileData, 'base64');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(r.resume.originalName));
  res.setHeader('Content-Type', r.resume.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

router.delete('/:id/resume', authMiddleware, requireRole('hr', 'admin'), async (req, res) => {
  const data = getData();
  const r = data.records.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  if (!r.resume) return res.status(404).json({ error: '该人员尚未上传简历' });

  r.resume = null;
  r.updatedAt = new Date().toISOString();
  await saveData();
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
router.post('/feedback-form/:token', upload.single('attachment'), async (req, res) => {
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
  await saveData();

  notifyFeedbackSubmitted(r);

  res.json({ success: true, message: '反馈已提交，人事将尽快处理' });
});

// ==================== HR代录反馈 - 支持附件上传 ====================
router.post('/:id/feedback', authMiddleware, requireRole('hr'), upload.single('attachment'), async (req, res) => {
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
  await saveData();

  notifyFeedbackSubmitted(r);

  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

// ==================== 办理结算（HR）- 不存金额，金额在本地 ====================
router.post('/:id/settlement', authMiddleware, requireRole('hr'), async (req, res) => {
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
  await saveData();
  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

// ==================== 办理入职（HR）- 通知@massie和@Zoe ====================
router.post('/:id/onboarding', authMiddleware, requireRole('hr'), async (req, res) => {
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
  await saveData();

  // 通知 @massie 和 @Zoe 办理入职
  notifyOnboarding(r);

  res.json({ success: true, record: filterRecord(r, req.user.role) });
});

module.exports = router;
