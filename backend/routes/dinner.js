const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const vision = require('../lib/vision');

const router = express.Router();

// ==================== 截图识别（免登录，员工上传即识别）====================
// 内存暂存图片，识别后不落盘（只返回字段），避免敏感截图堆积
const shotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 PNG/JPG/WEBP 截图'));
  }
});

router.post('/recognize', (req, res, next) => {
  shotUpload.single('image')(req, res, (err) => {
    if (err) {
      const msg = /LIMIT_FILE_SIZE/.test(err.code || '') ? '截图超过 8MB，请压缩后重试' : (err.message || '图片上传失败');
      return res.status(400).json({ error: msg, code: 'UPLOAD_ERROR' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请先选择截图' });
    const kind = req.body && req.body.kind === 'punch' ? 'punch' : 'order';
    const result = await vision.recognize(req.file.buffer, kind);
    res.json({
      success: true, kind,
      fields: result,
      configured: true
    });
  } catch (e) {
    const code = e.code || 'VISION_ERROR';
    const status = code === 'NO_VISION_KEY' ? 503 : (code === 'VISION_INCOMPLETE' ? 422 : 500);
    res.status(status).json({
      error: e.message || '识别失败',
      code,
      configured: vision.configured()
    });
  }
});

// 前端探测：视觉服务是否已配置
router.get('/recognize/status', (req, res) => {
  res.json({
    configured: vision.configured(),
    model: process.env.VISION_MODEL || vision.DEFAULT_MODEL,
    baseUrl: process.env.VISION_BASE_URL || vision.DEFAULT_BASE_URL
  });
});

// ==================== 凭证上传（multer）====================
// 凭证图片保存到 backend/uploads/dinner-receipts/，文件名随机
const RECEIPTS_DIR = path.join(__dirname, '..', 'uploads', 'dinner-receipts');
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RECEIPTS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
    cb(null, 'rc_' + crypto.randomBytes(8).toString('hex') + safeExt);
  }
});
const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 PNG/JPG/WEBP 图片'));
  }
});

// ==================== 判定引擎（与方案规则一致） ====================
const CUT_A = 19 * 60 + 30; // 19:30 通道A线：下单 ≥ 19:30 直接可报
const CUT_B = 20 * 60 + 30; // 20:30 通道B线：下单 < 19:30 需打卡 ≥ 20:30
const CAP_MEAL = 25;       // 单餐封顶
const CAP_WEEK = 100;      // 每人每周累计封顶

function toMin(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function mondayOf(dstr) {
  const d = new Date(dstr + 'T00:00:00');
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function fmtM(n) { return (Math.round(n * 10) / 10).toFixed(1); }

function judge(form, ai, records) {
  if (!ai || !ai.orderTime || !ai.punchTime || !ai.orderNo || !(ai.amount > 0)) {
    return { status: 'FAIL_BLUR', channel: '—', amount: 0, reason: '截图要素缺失：无法识别下单时间/打卡时间/订单号/金额，请重新上传清晰截图' };
  }
  if (ai.punchDate && ai.punchDate !== form.date) {
    return { status: 'FAIL_DATE', channel: '—', amount: 0, reason: '日期不一致：打卡日期(' + ai.punchDate + ')与用餐日期(' + form.date + ')不符' };
  }
  // 拼单人数（默认 1，即独自下单）
  const shared = Math.max(1, parseInt(form.sharedCount) || 1);
  const wk = mondayOf(form.date);

  // 同一人重复提交同一订单号 → 拒绝（不同人拼单放开，受下方订单总额度限制）
  const selfDup = (records || []).find(r =>
    r.name === form.name && r.ai && r.ai.orderNo === ai.orderNo && r.status && r.status.startsWith('PASS'));
  if (selfDup) {
    return { status: 'FAIL_DUP', channel: '—', amount: 0, reason: '订单号重复：本人已于 ' + selfDup.date + ' 提交过该订单' };
  }
  const om = toMin(ai.orderTime), pm = toMin(ai.punchTime);
  let channel, pass;
  if (om >= CUT_A) { channel = 'A'; pass = true; }
  else { channel = 'B'; pass = pm !== null && pm >= CUT_B; }
  if (!pass) {
    return {
      status: 'FAIL_TIME', channel, amount: 0,
      reason: '通道B：下单 ' + ai.orderTime + '（< 19:30），打卡 ' + ai.punchTime + ' 早于 20:30，未达加班晚餐条件'
    };
  }

  // 拼单均分：先按「实付 ÷ 拼单人数」计，再套单人 25 元封顶（向下取整，不超发）
  const perHead = Number(ai.amount) / shared;
  let amount = Math.floor(Math.min(perHead, CAP_MEAL) * 10) / 10;
  const cappedMeal = perHead > CAP_MEAL;

  // 订单总额锁：同一订单号已报销合计不得超过实付金额
  const orderClaimed = (records || [])
    .filter(r => r.ai && r.ai.orderNo === ai.orderNo && r.status && r.status.startsWith('PASS'))
    .reduce((s, r) => s + r.amount, 0);
  const orderRemaining = Math.floor((Number(ai.amount) - orderClaimed) * 10) / 10;
  let orderCapped = false;
  if (amount > orderRemaining) { amount = Math.max(0, orderRemaining); orderCapped = true; }
  if (amount <= 0) {
    return {
      status: 'FAIL_ORDERCAP', channel, amount: 0,
      reason: '该订单额度已领完：实付 ' + fmtM(ai.amount) + ' 元，已报 ' + fmtM(orderClaimed) + ' 元，无剩余可报'
    };
  }

  const used = (records || [])
    .filter(r => r.name === form.name && r.status && r.status.startsWith('PASS') && mondayOf(r.date) === wk)
    .reduce((s, r) => s + r.amount, 0);
  let weekCapped = false;
  if (used + amount > CAP_WEEK) {
    amount = Math.max(0, Math.floor((CAP_WEEK - used) * 10) / 10);
    weekCapped = amount > 0;
  }
  if (amount <= 0) {
    return { status: 'FAIL_WEEKCAP', channel, amount: 0, reason: '周封顶已满：本周累计 ' + fmtM(used) + ' 元已达 100 元上限' };
  }

  let status = channel === 'A' ? 'PASS_A' : 'PASS_B';
  let reason = channel === 'A'
    ? '通道A：下单 ' + ai.orderTime + ' ≥ 19:30，直接可报'
    : '通道B：下单 ' + ai.orderTime + ' < 19:30，打卡 ' + ai.punchTime + ' ≥ 20:30';
  if (shared > 1) {
    reason += '；' + shared + ' 人拼单实付 ' + fmtM(ai.amount) + ' 元，人均 ' + fmtM(perHead) + ' 元';
  }
  if (cappedMeal) reason += '；人均超 25 元，按单餐封顶报 25 元';
  if (orderCapped) {
    status = 'PASS_CAPPED';
    reason += '；该订单剩余额度仅 ' + fmtM(orderRemaining) + ' 元，本次按剩余报销';
  }
  if (weekCapped) {
    status = 'PASS_CAPPED';
    reason += '；本周已累计 ' + fmtM(used) + ' 元，超周封顶，本次仅可报 ' + fmtM(amount) + ' 元';
  }
  return { status, channel, amount, reason, used, shared, orderClaimed };
}

// ==================== 员工提交（免登录，同问卷模式） ====================
router.post('/', async (req, res) => {
  const { name, dept1, dept2, date, ali, aliname, orderTime, doneTime, orderNo, amount, punchTime, punchDate, sharedCount } = req.body;

  if (!name) return res.status(400).json({ error: '请填写姓名' });
  if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '请选择用餐日期' });
  if (!ali) return res.status(400).json({ error: '请填写支付宝账号（用于转账）' });
  if (!aliname) return res.status(400).json({ error: '请填写支付宝实名姓名（填真实姓名，勿填小名）' });
  const shared = Math.max(1, parseInt(sharedCount) || 1);
  if (shared > 20) return res.status(400).json({ error: '拼单人数不合理，请如实填写' });

  const form = {
    name: String(name).trim(), dept1: String(dept1).trim(), dept2: String(dept2 || '').trim(),
    date, ali: String(ali).trim(), aliname: String(aliname).trim(), sharedCount: shared
  };
  const ai = {
    orderTime: (orderTime || '').trim(), doneTime: (doneTime || '').trim(),
    orderNo: (orderNo || '').trim(), amount: Number(amount) || 0,
    punchTime: (punchTime || '').trim(), punchDate: (punchDate || '').trim()
  };
  const hasAI = ai.orderTime && ai.punchTime && ai.orderNo && ai.amount > 0;

  const data = getData();
  if (!data.dinnerRecords) data.dinnerRecords = [];

  const result = judge(form, hasAI ? ai : null, data.dinnerRecords);
  const entry = {
    id: 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ...form,
    ai: hasAI ? ai : {},
    status: result.status,
    channel: result.channel,
    amount: result.amount,
    reason: result.reason,
    weekUsed: result.used || 0,
    sharedCount: shared,
    orderClaimed: (result.orderClaimed || 0) + (result.amount > 0 ? result.amount : 0),
    createdAt: new Date().toISOString()
  };
  data.dinnerRecords.push(entry);
  await saveData();

  const pass = result.status.startsWith('PASS');
  res.json({
    success: true, id: entry.id, pass,
    status: result.status, channel: result.channel,
    amount: result.amount, reason: result.reason,
    weekUsed: result.used || 0, sharedCount: shared
  });
});

// ==================== 拼单批量提交（免登录） ====================
// 场景：一人点单付款，收齐大家的打卡截图后一次性提交
// body: { date, dept1, dept2, sharedCount, order:{orderTime,doneTime,orderNo,amount},
//        members:[{name, punchTime, punchDate, ali, aliname}, ...] }
router.post('/group', async (req, res) => {
  const { date, dept1, dept2, sharedCount, order, members } = req.body || {};

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '请选择用餐日期' });
  if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!order || !order.orderTime || !order.orderNo || !(Number(order.amount) > 0)) {
    return res.status(400).json({ error: '订单截图识别失败，请重新上传清晰的外卖订单截图' });
  }
  const n = Math.max(1, parseInt(sharedCount) || 1);
  if (!Array.isArray(members) || !members.length) return res.status(400).json({ error: '请填写就餐人员' });
  if (members.length !== n) {
    return res.status(400).json({ error: '就餐人数（' + n + '）与填写的人员数（' + members.length + '）不一致' });
  }

  // 逐人校验
  const names = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i] || {};
    const nm = String(m.name || '').trim();
    if (!nm) return res.status(400).json({ error: '第 ' + (i + 1) + ' 位同事的姓名未填写' });
    if (names.includes(nm)) return res.status(400).json({ error: '姓名重复：' + nm + '，请检查' });
    names.push(nm);
    if (!m.punchTime || !m.punchDate) {
      return res.status(400).json({ error: nm + ' 的打卡截图识别失败，请重新上传' });
    }
    if (!String(m.ali || '').trim() || !String(m.aliname || '').trim()) {
      return res.status(400).json({ error: '请填写 ' + nm + ' 的支付宝账号与实名姓名' });
    }
  }

  const data = getData();
  if (!data.dinnerRecords) data.dinnerRecords = [];

  // 逐人判定；本批已处理的人也要计入订单总额锁与同人重复校验
  const batch = [];
  const results = [];
  for (const m of members) {
    const form = {
      name: String(m.name).trim(),
      dept1: String(dept1).trim(),
      dept2: String(dept2 || '').trim(),
      date,
      ali: String(m.ali).trim(),
      aliname: String(m.aliname).trim(),
      sharedCount: n
    };
    const ai = {
      orderTime: String(order.orderTime).trim(),
      doneTime: String(order.doneTime || order.orderTime).trim(),
      orderNo: String(order.orderNo).trim(),
      amount: Number(order.amount),
      punchTime: String(m.punchTime).trim(),
      punchDate: String(m.punchDate).trim()
    };
    const result = judge(form, ai, data.dinnerRecords.concat(batch));
    const entry = {
      id: 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ...form,
      ai,
      status: result.status,
      channel: result.channel,
      amount: result.amount,
      reason: result.reason,
      weekUsed: result.used || 0,
      sharedCount: n,
      groupNo: 'G' + Date.now().toString(36),
      orderClaimed: (result.orderClaimed || 0) + (result.amount > 0 ? result.amount : 0),
      createdAt: new Date().toISOString()
    };
    batch.push(entry);
    results.push({
      name: entry.name, id: entry.id, pass: result.status.startsWith('PASS'),
      status: result.status, channel: result.channel, amount: result.amount,
      reason: result.reason, weekUsed: result.used || 0
    });
  }

  // 同一批共享 groupNo，便于后台追溯
  const groupNo = batch.length ? batch[0].groupNo : null;
  batch.forEach(b => { b.groupNo = groupNo; });

  data.dinnerRecords.push(...batch);
  await saveData();

  const passCount = results.filter(r => r.pass).length;
  res.json({
    success: true, groupNo, sharedCount: n,
    perHead: Math.floor(Math.min(Number(order.amount) / n, 25) * 10) / 10,
    totalAmount: results.reduce((s, r) => s + r.amount, 0),
    passCount, failCount: results.length - passCount,
    results
  });
});

// ==================== 台账（登录可见） ====================
router.get('/records', authMiddleware, (req, res) => {
  const data = getData();
  const list = (data.dinnerRecords || []).slice().sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ records: list });
});

// ==================== 删除误提交（行政/HR） ====================
router.delete('/records/:id', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  if (!data.dinnerRecords) return res.status(404).json({ error: '无晚餐报销数据' });
  const idx = data.dinnerRecords.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '记录不存在' });
  const removed = data.dinnerRecords.splice(idx, 1)[0];
  await saveData();
  res.json({ success: true, removedId: removed.id });
});

// ==================== 打款：单条 ====================
// 管理员上传打款凭证（图片，可选 note 备注），标记记录为已打款
router.post('/records/:id/pay', authMiddleware, requireRole('admin', 'hr'),
  receiptUpload.single('receipt'), async (req, res) => {
    const data = getData();
    const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: '记录不存在' });
    if (!r.status || !r.status.startsWith('PASS')) return res.status(400).json({ error: '仅通过的记录可标记打款' });
    const note = (req.body && req.body.note || '').toString().trim();
    r.paid = true;
    r.paidAt = new Date().toISOString();
    r.paidBatchId = r.paidBatchId || ('B' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'));
    r.paidReceipt = {
      type: req.file ? 'image' : (note ? 'note' : null),
      url: req.file ? ('/uploads/dinner-receipts/' + req.file.filename) : null,
      note: note || ''
    };
    r.paidBy = req.user.username;
    await saveData();
    res.json({ success: true, id: r.id, paid: true, paidAt: r.paidAt, paidBatchId: r.paidBatchId });
  }
);

// ==================== 打款：批量（一次性给一人多笔） ====================
// ids 用逗号分隔；上传一张凭证对应一次支付宝转账；同一批次记录共享 paidBatchId
router.post('/records/batch-pay', authMiddleware, requireRole('admin', 'hr'),
  receiptUpload.single('receipt'), async (req, res) => {
    const idsRaw = (req.body && req.body.ids || '').toString();
    const note = (req.body && req.body.note || '').toString().trim();
    const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: '请选择要打款的记录（ids 为空）' });
    const data = getData();
    const batchId = 'B' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const now = new Date().toISOString();
    const updated = [];
    const skipped = [];
    for (const id of ids) {
      const r = (data.dinnerRecords || []).find(x => x.id === id);
      if (!r) { skipped.push({ id, reason: '记录不存在' }); continue; }
      if (!r.status || !r.status.startsWith('PASS')) { skipped.push({ id, reason: '非通过记录' }); continue; }
      r.paid = true;
      r.paidAt = now;
      r.paidBatchId = batchId;
      r.paidReceipt = {
        type: req.file ? 'image' : (note ? 'note' : null),
        url: req.file ? ('/uploads/dinner-receipts/' + req.file.filename) : null,
        note: note || ''
      };
      r.paidBy = req.user.username;
      updated.push({ id: r.id, amount: r.amount });
    }
    await saveData();
    res.json({
      success: true, batchId, paidCount: updated.length,
      totalAmount: updated.reduce((s, x) => s + x.amount, 0),
      skipped
    });
  }
);

// ==================== 取消打款标记（误点可撤回）====================
router.post('/records/:id/unpay', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  r.paid = false;
  r.paidAt = null;
  r.paidBy = null;
  // 不删 paidBatchId / paidReceipt，留作历史
  await saveData();
  res.json({ success: true, id: r.id, paid: false });
});

module.exports = router;
