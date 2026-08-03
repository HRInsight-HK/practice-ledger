const express = require('express');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { notifyQuestionnaireSubmitted } = require('../lib/wecom-bot');

const router = express.Router();

const ROLE_LABELS = {
  manager: '管理层',
  leader: '组长',
  employee: '员工'
};

// ==================== 公开提交问卷（免登录） ====================
router.post('/', (req, res) => {
  const {
    submitterName, submitterRole, personName, mentorName,
    dept1, dept2, businessArea, expectStart, expectDays, deviceNeed, remark
  } = req.body;

  if (!submitterName) return res.status(400).json({ error: '请填写提交人姓名' });
  if (!submitterRole || !ROLE_LABELS[submitterRole]) return res.status(400).json({ error: '请选择您的身份' });
  if (!personName) return res.status(400).json({ error: '请填写实操人员姓名' });
  if (!mentorName) return res.status(400).json({ error: '请填写建议带教人' });
  if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!expectStart) return res.status(400).json({ error: '请选择期望开始日期' });
  if (!expectDays || expectDays < 1) return res.status(400).json({ error: '请填写有效的实操天数' });

  const data = getData();
  const entry = {
    id: 'Q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    submitterName,
    submitterRole,
    submitterRoleLabel: ROLE_LABELS[submitterRole],
    personName,
    mentorName,
    dept1,
    dept2: dept2 || '',
    businessArea: businessArea || '',
    expectStart,
    expectDays: parseInt(expectDays),
    deviceNeed: deviceNeed || '',
    remark: remark || '',
    status: 'pending', // pending / imported / dismissed
    createdAt: new Date().toISOString()
  };

  if (!data.questionnaires) data.questionnaires = [];
  data.questionnaires.push(entry);
  await saveData();

  // 企微群通知：有新问卷提交
  notifyQuestionnaireSubmitted(entry);

  res.json({ success: true, id: entry.id });
});

// ==================== 获取问卷列表（行政/HR/管理层） ====================
router.get('/', authMiddleware, (req, res) => {
  const data = getData();
  const list = (data.questionnaires || []).sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ questionnaires: list });
});

// ==================== 一键导入为台账记录 ====================
router.post('/:id/import', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  const data = getData();
  const q = (data.questionnaires || []).find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: '问卷不存在' });
  if (q.status === 'imported') return res.status(400).json({ error: '该问卷已导入' });

  // 覆盖字段（行政可修改）
  const {
    name, mentor, dept1, dept2, startDate, practiceDays,
    deviceModel, accessories, serialNumber, remark
  } = req.body;

  const finalName = name || q.personName;
  const finalMentor = mentor || q.mentorName;
  const finalDept1 = dept1 || q.dept1 || '';
  const finalDept2 = dept2 || q.dept2 || '';
  const finalStart = startDate || q.expectStart;
  const finalDays = parseInt(practiceDays) || q.expectDays;

  if (!finalName) return res.status(400).json({ error: '请填写实操人员姓名' });
  if (!finalMentor) return res.status(400).json({ error: '请填写带教人' });
  if (!finalDept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!finalDays || finalDays < 1) return res.status(400).json({ error: '请填写有效的实操天数' });
  if (!finalStart) return res.status(400).json({ error: '请选择开始日期' });

  const addDays = (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + parseInt(days));
    return d.toISOString().slice(0, 10);
  };
  const today = new Date().toISOString().slice(0, 10);
  const endDate = addDays(finalStart, finalDays);
  let status = 'practicing';
  if (endDate <= today) status = 'feedback_pending';

  const record = {
    id: 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: finalName,
    mentor: finalMentor,
    dept1: finalDept1,
    dept2: finalDept2,
    startDate: finalStart,
    practiceDays: finalDays,
    endDate,
    deviceModel: deviceModel || q.deviceNeed || '',
    accessories: accessories || '',
    serialNumber: serialNumber || '',
    remark: remark || q.remark || '',
    businessArea: q.businessArea || '',
    status,
    feedback: null,
    settlement: null,
    onboarding: null,
    feedbackToken: require('crypto').randomBytes(12).toString('hex'),
    sourceQuestionnaireId: q.id,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.records.push(record);

  // 更新问卷状态
  q.status = 'imported';
  q.importedRecordId = record.id;
  q.importedAt = new Date().toISOString();
  q.importedBy = req.user.username;

  await saveData();

  // 企微通知：新实操人员已登记
  const { notifyRecordCreated } = require('../lib/wecom-bot');
  notifyRecordCreated(record);

  res.json({ success: true, recordId: record.id });
});

// ==================== 忽略/删除问卷 ====================
router.delete('/:id', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  const data = getData();
  if (!data.questionnaires) return res.status(404).json({ error: '无问卷数据' });
  const idx = data.questionnaires.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '问卷不存在' });
  data.questionnaires.splice(idx, 1);
  await saveData();
  res.json({ success: true });
});

module.exports = router;
