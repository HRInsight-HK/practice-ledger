const express = require('express');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');

const router = express.Router();

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
  const wk = mondayOf(form.date);
  const dup = (records || []).find(r => r.ai && r.ai.orderNo === ai.orderNo && r.status && r.status.startsWith('PASS'));
  if (dup) {
    return { status: 'FAIL_DUP', channel: '—', amount: 0, reason: '订单号重复：该订单已于 ' + dup.date + ' 提交并通过' };
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
  let amount = Math.min(Number(ai.amount), CAP_MEAL);
  const cappedMeal = Number(ai.amount) > CAP_MEAL;
  const used = (records || [])
    .filter(r => r.name === form.name && r.status && r.status.startsWith('PASS') && mondayOf(r.date) === wk)
    .reduce((s, r) => s + r.amount, 0);
  let weekCapped = false;
  if (used + amount > CAP_WEEK) {
    amount = Math.max(0, CAP_WEEK - used);
    weekCapped = amount > 0;
  }
  if (amount <= 0) {
    return { status: 'FAIL_WEEKCAP', channel, amount: 0, reason: '周封顶已满：本周累计 ' + fmtM(used) + ' 元已达 100 元上限' };
  }
  let status = channel === 'A' ? 'PASS_A' : 'PASS_B';
  let reason = channel === 'A'
    ? '通道A：下单 ' + ai.orderTime + ' ≥ 19:30，直接可报'
    : '通道B：下单 ' + ai.orderTime + ' < 19:30，打卡 ' + ai.punchTime + ' ≥ 20:30';
  if (cappedMeal) reason += '；实付 ' + fmtM(ai.amount) + ' 超 25 元，按单餐封顶报 25 元';
  if (weekCapped) {
    status = 'PASS_CAPPED';
    reason += '；本周已累计 ' + fmtM(used) + ' 元，超周封顶，本次仅可报 ' + fmtM(amount) + ' 元';
  }
  return { status, channel, amount, reason, used };
}

// ==================== 员工提交（免登录，同问卷模式） ====================
router.post('/', async (req, res) => {
  const { name, dept1, dept2, date, ali, aliname, orderTime, doneTime, orderNo, amount, punchTime, punchDate } = req.body;

  if (!name) return res.status(400).json({ error: '请填写姓名' });
  if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '请选择用餐日期' });
  if (!ali) return res.status(400).json({ error: '请填写支付宝账号（用于转账）' });
  if (!aliname) return res.status(400).json({ error: '请填写支付宝实名姓名（填真实姓名，勿填小名）' });

  const form = { name: String(name).trim(), dept1: String(dept1).trim(), dept2: String(dept2 || '').trim(), date, ali: String(ali).trim(), aliname: String(aliname).trim() };
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
    createdAt: new Date().toISOString()
  };
  data.dinnerRecords.push(entry);
  await saveData();

  const pass = result.status.startsWith('PASS');
  res.json({
    success: true, id: entry.id, pass,
    status: result.status, channel: result.channel,
    amount: result.amount, reason: result.reason,
    weekUsed: result.used || 0
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

module.exports = router;
