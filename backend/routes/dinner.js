const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const vision = require('../lib/vision');

const router = express.Router();

// ==================== 图片持久化：base64 存数据库 ====================
// Render 免费版磁盘是临时的，部署重启会清空 uploads/，导致已上传证明图变成 HTML 兜底页。
// 方案A：图片以 base64（dataURL）直接存进数据库（Postgres/Supabase JSONB），部署不丢。
// 旧记录若只有 URL（orderImg/punchImg）则回退读文件系统（本地开发）。

// 从 dataURL 提取图片 buffer；输入可为完整 dataURL 或裸 base64。取不到返回 null。
function dataUrlToBuffer(data) {
  if (!data) return null;
  let s = String(data).trim();
  if (!s) return null;
  const comma = s.indexOf(',');
  if (comma !== -1) s = s.slice(comma + 1);          // 去掉 data:image/xxx;base64, 前缀
  if (!s) return null;
  try { return Buffer.from(s, 'base64'); } catch (e) { return null; }
}
// 返回「纯 base64 字符串」（去掉 dataURL 前缀），用于存库；不合法返回 null
function dataUrlToB64(data) {
  const buf = dataUrlToBuffer(data);
  return buf ? buf.toString('base64') : null;
}
// 识别时读取图片 buffer：优先库内 base64，否则读文件系统（兼容旧记录/本地）
function readImgBuffer(r, field) {
  const b64 = r && (r[field + 'Data']);
  if (b64) { try { return Buffer.from(b64, 'base64'); } catch (e) {} }
  const u = r && r[field === 'orderImg' ? 'orderImg' : 'punchImg'];
  if (u) {
    const abs = path.join(__dirname, '..', u.replace(/^\//, ''));
    if (fs.existsSync(abs)) return fs.readFileSync(abs);
  }
  return null;
}

// 视觉服务配置探测
router.get('/recognize/status', (req, res) => {
  res.json({
    configured: vision.configured(),
    model: process.env.VISION_MODEL || vision.DEFAULT_MODEL,
    baseUrl: process.env.VISION_BASE_URL || vision.DEFAULT_BASE_URL
  });
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

// 判定：基于「已确认字段」（人工通过时用员工/修正字段，识别一致时用识别字段）
function judge(form, ai, records) {
  if (!ai || !ai.orderTime || !ai.punchTime || !ai.orderNo || !(ai.amount > 0)) {
    return { status: 'FAIL_BLUR', channel: '—', amount: 0, reason: '要素缺失：无法确定下单时间/打卡时间/订单号/金额，请人工核实' };
  }
  if (ai.punchDate && form.date && ai.punchDate !== form.date) {
    return { status: 'FAIL_DATE', channel: '—', amount: 0, reason: '日期不一致：打卡日期(' + ai.punchDate + ')与用餐日期(' + form.date + ')不符' };
  }
  const shared = Math.max(1, parseInt(form.sharedCount) || 1);
  const wk = mondayOf(form.date);

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

  const perHead = Number(ai.amount) / shared;
  let amount = Math.floor(Math.min(perHead, CAP_MEAL) * 10) / 10;
  const cappedMeal = perHead > CAP_MEAL;

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

// ==================== 员工提交（免登录，零等待） ====================
// JSON：表单字段 + 1 张订单证明图(orderData, dataURL) + N 张打卡证明图(punchData[], dataURL)
// 图片以 base64 存数据库（不落盘，避免 Render 临时盘清空导致图片丢失）
router.post('/group', async (req, res) => {
  try {
    const body = req.body || {};
    const date = (body.date || '').trim();
    const dept1 = (body.dept1 || '').trim();
    const dept2 = (body.dept2 || '').trim();
    const sharedCount = parseInt(body.sharedCount) || 1;
    const members = Array.isArray(body.members) ? body.members : [];

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '请选择用餐日期' });
    if (!dept1) return res.status(400).json({ error: '请填写一级部门' });
    if (!members.length) return res.status(400).json({ error: '请填写就餐人员' });
    if (members.length !== sharedCount) {
      return res.status(400).json({ error: '就餐人数（' + sharedCount + '）与填写的人员数（' + members.length + '）不一致' });
    }
    if (sharedCount > 20) return res.status(400).json({ error: '拼单人数不合理' });

    // 订单证明图：body.orderData (dataURL)
    const orderData = String(body.orderData || '').trim();
    if (!orderData || orderData.length < 50) return res.status(400).json({ error: '请上传 1 张外卖订单证明图' });
    const orderB64 = dataUrlToB64(orderData);
    if (!orderB64) return res.status(400).json({ error: '订单证明图格式无效，请重新上传' });

    // 每人打卡证明图：body.punchData 数组
    const punchData = Array.isArray(body.punchData) ? body.punchData.map(x => String(x || '').trim()) : [];
    if (punchData.length !== members.length) {
      return res.status(400).json({ error: '需为每人上传 1 张打卡证明图（共 ' + members.length + ' 张，当前 ' + punchData.length + ' 张）' });
    }
    const punchB64 = punchData.map(d => dataUrlToB64(d));
    if (punchB64.some(b => !b)) return res.status(400).json({ error: '存在无效的打卡证明图，请重新上传' });

    // 逐人校验
    const names = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i] || {};
      const nm = String(m.name || '').trim();
      if (!nm) return res.status(400).json({ error: '第 ' + (i + 1) + ' 位同事的姓名未填写' });
      if (names.includes(nm)) return res.status(400).json({ error: '姓名重复：' + nm + '，请检查' });
      names.push(nm);
      if (!String(m.ali || '').trim() || !String(m.aliname || '').trim()) {
        return res.status(400).json({ error: '请填写 ' + nm + ' 的支付宝账号与实名姓名' });
      }
    }

    const data = getData();
    if (!data.dinnerRecords) data.dinnerRecords = [];

    const batch = [];
    const groupNo = 'G' + Date.now().toString(36);
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      // 员工填写的字段（可选填，用于核对）
      const fields = {
        orderTime: String(m.orderTime || body.orderTime || '').trim(),
        doneTime: String(m.doneTime || body.doneTime || '').trim(),
        orderNo: String(m.orderNo || body.orderNo || '').trim(),
        amount: Number(m.amount != null ? m.amount : body.amount) || 0,
        punchTime: String(m.punchTime || '').trim(),
        punchDate: String(m.punchDate || '').trim()
      };
      const entry = {
        id: 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: String(m.name).trim(),
        dept1, dept2: String(dept2 || '').trim(),
        date,
        ali: String(m.ali).trim(),
        aliname: String(m.aliname).trim(),
        sharedCount,
        groupNo,
        fields,             // 员工填写（待核验）
        ai: {},             // 识别结果（后台填）
        orderImgData: orderB64,      // 订单证明图（base64，持久化）
        punchImgData: punchB64[i],   // 打卡证明图（base64，持久化）
        reviewStatus: 'pendingVerify',   // pendingVerify 待识别比对 | pendingManual 待人工审核 | verified 已通过 | rejected 已驳回
        verifyInfo: null,   // 比对结果说明
        status: null, channel: null, amount: 0, reason: null, weekUsed: 0, orderClaimed: 0,
        createdAt: new Date().toISOString()
      };
      batch.push(entry);
    }

    data.dinnerRecords.push(...batch);
    await saveData();

    res.json({
      success: true, groupNo, sharedCount: members.length,
      submitted: batch.length,
      message: '提交成功，待后台审核'
    });
  } catch (e) {
    if (e && e.type === 'entity.parse.failed') return res.status(400).json({ error: '提交数据格式错误，请刷新后重试' });
    res.status(500).json({ error: (e && e.message) || '提交失败' });
  }
});

// ==================== 后台触发识别比对（单条） ====================
// 读员工填写的 orderImg + punchImg，识别实际时间，与员工填写比对：
//   一致 → 自动判定（verified + PASS/FAIL）
//   不一致/识别失败/未填写 → pendingManual（待人工审核）
router.post('/records/:id/recognize', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  // 已核验通过或已驳回的记录不允许再识别；待识别/待人工可反复重试识别（智谱限速恢复后再试）
  if (r.reviewStatus === 'verified' || r.reviewStatus === 'rejected') {
    return res.status(400).json({ error: '该记录已核验，无需重复识别' });
  }
  // 重试识别：清掉上一次的核验信息，重新比对
  r.verifyInfo = undefined;
  try {
    const out = await recognizeOne(data, r);
    await saveData();
    return res.json({ success: true, id: r.id, ...out, configured: vision.configured() });
  } catch (e) {
    // 识别异常 → 待人工审核，保留信息
    const code = e.code || 'VISION_ERROR';
    const imageMissing = code === 'IMAGE_MISSING';
    r.reviewStatus = 'pendingManual';
    r.verifyInfo = {
      matched: false,
      code,
      imageMissing,
      missing: e.missing || [],
      error: e.message,
      differences: [imageMissing ? e.message : ('识别失败：' + (e.message || ''))],
      decidedAt: new Date().toISOString()
    };
    await saveData().catch(() => {});
    res.status(code === 'NO_VISION_KEY' ? 503 : 200).json({
      success: false, id: r.id, reviewStatus: 'pendingManual',
      matched: false, error: e.message, code, imageMissing,
      configured: vision.configured()
    });
  }
});

// ==================== 整单识别（同一 groupNo 批量） ====================
router.post('/group/:groupNo/recognize', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const records = (data.dinnerRecords || []).filter(x => x.groupNo === req.params.groupNo && (x.reviewStatus === 'pendingVerify' || x.reviewStatus === 'pendingManual'));
  if (!records.length) return res.status(404).json({ error: '未找到待核验的整单记录' });
  const results = [];
  for (const r of records) {
    try {
      const out = await recognizeOne(data, r);
      results.push({ id: r.id, name: r.name, ok: true, ...out });
    } catch (e) {
      const code = e.code || 'VISION_ERROR';
      const imageMissing = code === 'IMAGE_MISSING';
      r.reviewStatus = 'pendingManual';
      r.verifyInfo = {
        matched: false, code, imageMissing, missing: e.missing || [],
        error: e.message,
        differences: [imageMissing ? e.message : ('识别失败：' + (e.message || ''))],
        decidedAt: new Date().toISOString()
      };
      results.push({ id: r.id, name: r.name, ok: false, error: e.message, code, imageMissing });
    }
  }
  await saveData();
  res.json({ success: true, count: records.length, results });
});

async function recognizeOne(data, r) {
  // 优先库内 base64，其次文件系统（兼容旧记录/本地开发）
  const orderBuf = readImgBuffer(r, 'orderImg');
  const punchBuf = readImgBuffer(r, 'punchImg');
  // 图片全部丢失（Render 临时盘清空 / 旧记录没 base64）：直接抛出，不浪费智谱配额
  const orderHas = !!(r.orderImgData || r.orderImg);
  const punchHas = !!(r.punchImgData || r.punchImg);
  if ((orderHas && !orderBuf) || (punchHas && !punchBuf) || (!orderBuf && !punchBuf)) {
    const missing = [];
    if (orderHas && !orderBuf) missing.push('订单图');
    if (punchHas && !punchBuf) missing.push('打卡图');
    const err = new Error(missing.length ? ('图片已丢失：' + missing.join('、') + '（部署重启清空），请员工重新提交') : '证明图缺失');
    err.code = 'IMAGE_MISSING';
    err.missing = missing;
    throw err;
  }
  const orderAI = orderBuf ? await vision.recognize(orderBuf, 'order') : null;
  const punchAI = punchBuf ? await vision.recognize(punchBuf, 'punch') : null;
  const ai = {
    orderTime: orderAI ? orderAI.orderTime : null,
    doneTime: orderAI ? (orderAI.doneTime || orderAI.orderTime) : null,
    orderNo: orderAI ? orderAI.orderNo : null,
    amount: orderAI ? orderAI.amount : null,
    punchTime: punchAI ? punchAI.punchTime : null,
    punchDate: punchAI ? punchAI.punchDate : null,
    orderConfidence: orderAI ? orderAI.confidence : null,
    punchConfidence: punchAI ? punchAI.confidence : null
  };
  r.ai = ai;
  const f = r.fields || {};
  const mismatch = [];
  // 通用比对：日期走字符串比较；时间走分钟比较（±3 分钟容差）
  const cmpTime = (filled, aiVal, label) => {
    if (!filled && !aiVal) return null;
    if (filled && !aiVal) { mismatch.push(label + '：员工填写 ' + filled + '，截图识别不出'); return false; }
    if (!filled && aiVal) { mismatch.push(label + '：员工未填写，截图识别为 ' + aiVal); return false; }
    const isTime = /^\d{1,2}:\d{2}$/.test(filled) && /^\d{1,2}:\d{2}$/.test(aiVal);
    if (isTime) {
      const fmin = toMin(filled), amin = toMin(aiVal);
      if (Math.abs(fmin - amin) > 3) { mismatch.push(label + '：员工填写 ' + filled + '，截图识别 ' + aiVal); return false; }
    } else {
      if (String(filled).trim() !== String(aiVal).trim()) { mismatch.push(label + '：员工填写 ' + filled + '，截图识别 ' + aiVal); return false; }
    }
    return true;
  };
  let matched = true;
  if (r.punchImg) { if (!cmpTime(f.punchTime, ai.punchTime, '打卡时间')) matched = false; if (!cmpTime(f.punchDate, ai.punchDate, '打卡日期')) matched = false; }
  if (r.orderImg) {
    if (!cmpTime(f.orderTime, ai.orderTime, '下单时间')) matched = false;
    if (f.orderNo && ai.orderNo && String(f.orderNo).trim() !== String(ai.orderNo).trim()) { mismatch.push('订单号：员工 ' + f.orderNo + ' / 识别 ' + ai.orderNo); matched = false; }
    if (f.amount && ai.amount && Math.abs(Number(f.amount) - Number(ai.amount)) > 0.5) { mismatch.push('金额：员工 ' + f.amount + ' / 识别 ' + ai.amount); matched = false; }
  }
  if (!matched) {
    r.reviewStatus = 'pendingManual';
    r.verifyInfo = { matched: false, differences: mismatch, decidedAt: new Date().toISOString() };
    return { matched: false, reviewStatus: 'pendingManual', differences: mismatch, ai };
  }
  const finalAI = {
    orderTime: ai.orderTime || f.orderTime, doneTime: ai.doneTime, orderNo: ai.orderNo || f.orderNo,
    amount: ai.amount || Number(f.amount) || 0, punchTime: ai.punchTime || f.punchTime, punchDate: ai.punchDate || f.punchDate
  };
  const result = judge(r, finalAI, data.dinnerRecords);
  r.status = result.status; r.channel = result.channel; r.amount = result.amount;
  r.reason = result.reason; r.weekUsed = result.used || 0;
  r.orderClaimed = (result.orderClaimed || 0) + (result.amount > 0 ? result.amount : 0);
  r.reviewStatus = 'verified';
  r.verifyInfo = { matched: true, decidedAt: new Date().toISOString(), note: '员工填写与截图识别一致，自动判定' };
  return { matched: true, reviewStatus: 'verified', status: r.status, channel: r.channel, amount: r.amount, ai };
}

// ==================== 人工审核（管理员核验通过/驳回） ====================
// body: { action: 'approve' | 'reject', fields?: {orderTime, doneTime, orderNo, amount, punchTime, punchDate}, note? }
router.post('/records/:id/manual-review', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  const action = req.body && req.body.action;
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'action 需为 approve 或 reject' });

  if (action === 'reject') {
    r.reviewStatus = 'rejected';
    r.status = 'FAIL_MANUAL';
    r.reason = (req.body && req.body.note) || '人工审核不通过';
    r.verifyInfo = { matched: false, decidedAt: new Date().toISOString(), note: r.reason };
    await saveData();
    return res.json({ success: true, id: r.id, reviewStatus: 'rejected', status: r.status });
  }

  // approve：管理员可修正字段，然后正式判定
  const override = (req.body && req.body.fields) || {};
  const f = r.fields || {};
  const finalAI = {
    orderTime: (override.orderTime != null ? String(override.orderTime) : (f.orderTime || (r.ai && r.ai.orderTime) || '')).trim(),
    doneTime: (override.doneTime != null ? String(override.doneTime) : (f.doneTime || (r.ai && r.ai.doneTime) || '')).trim(),
    orderNo: (override.orderNo != null ? String(override.orderNo) : (f.orderNo || (r.ai && r.ai.orderNo) || '')).trim(),
    amount: Number(override.amount != null ? override.amount : (f.amount || (r.ai && r.ai.amount) || 0)),
    punchTime: (override.punchTime != null ? String(override.punchTime) : (f.punchTime || (r.ai && r.ai.punchTime) || '')).trim(),
    punchDate: (override.punchDate != null ? String(override.punchDate) : (f.punchDate || (r.ai && r.ai.punchDate) || r.date)).trim()
  };
  if (finalAI.punchDate && !finalAI.punchDate.includes('-') && r.date) finalAI.punchDate = r.date;

  const result = judge(r, finalAI, data.dinnerRecords);
  r.status = result.status;
  r.channel = result.channel;
  r.amount = result.amount;
  r.reason = result.reason;
  r.weekUsed = result.used || 0;
  r.orderClaimed = (result.orderClaimed || 0) + (result.amount > 0 ? result.amount : 0);
  r.reviewStatus = 'verified';
  r.verifyInfo = {
    matched: true, decidedAt: new Date().toISOString(),
    note: '人工审核通过' + ((req.body && req.body.note) ? '（' + req.body.note + '）' : ''),
    finalTime: finalAI.orderTime, finalPunch: finalAI.punchTime
  };
  await saveData();
  res.json({
    success: true, id: r.id, reviewStatus: 'verified',
    status: r.status, channel: r.channel, amount: r.amount, reason: r.reason
  });
});

// ==================== 一键诊断：标记图片已丢失的旧记录为待人工 ====================
// Render 临时盘清空后，旧记录（base64 改造前的）证明图已无法读取。
// 这条接口把这类记录批量置为 pendingManual + 标注 imageMissing，避免每次手动触发识别都浪费智谱配额。
// 也用于上线后清理历史脏数据。
router.post('/records/mark-image-missing', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  let updated = 0;
  for (const r of (data.dinnerRecords || [])) {
    if (r.reviewStatus !== 'pendingVerify') continue;
    const orderMissing = !!(r.orderImg && !r.orderImgData && !readImgBuffer(r, 'orderImg'));
    const punchMissing = !!(r.punchImg && !r.punchImgData && !readImgBuffer(r, 'punchImg'));
    if (!orderMissing && !punchMissing) continue;
    const missing = [];
    if (orderMissing) missing.push('订单图');
    if (punchMissing) missing.push('打卡图');
    r.reviewStatus = 'pendingManual';
    r.verifyInfo = {
      matched: false, code: 'IMAGE_MISSING', imageMissing: true, missing,
      error: '图片已丢失：' + missing.join('、') + '（部署重启清空），请员工重新提交',
      differences: ['图片已丢失，请员工重新提交'],
      decidedAt: new Date().toISOString()
    };
    updated++;
  }
  await saveData();
  res.json({ success: true, updated });
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
// body: { note?, receiptData? }  receiptData 为打款凭证 dataURL（base64 存库，避免 Render 清盘）
router.post('/records/:id/pay', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  if (!r.status || !r.status.startsWith('PASS')) return res.status(400).json({ error: '仅通过的记录可标记打款' });
  const body = req.body || {};
  const note = String(body.note || '').toString().trim();
  const receiptB64 = dataUrlToB64(body.receiptData);
  r.paid = true;
  r.paidAt = new Date().toISOString();
  r.paidBatchId = r.paidBatchId || ('B' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'));
  r.paidReceipt = {
    type: receiptB64 ? 'image' : (note ? 'note' : null),
    receiptData: receiptB64 || null,   // 持久化凭证（base64）
    url: r.paidReceipt && r.paidReceipt.url ? r.paidReceipt.url : null,  // 兼容旧记录
    note: note || ''
  };
  r.paidBy = req.user.username;
  await saveData();
  res.json({ success: true, id: r.id, paid: true, paidAt: r.paidAt, paidBatchId: r.paidBatchId });
});

// ==================== 打款：批量（一次性给一人多笔） ====================
router.post('/records/batch-pay', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const body = req.body || {};
  const idsRaw = String(body.ids || '').toString();
  const note = String(body.note || '').toString().trim();
  const receiptB64 = dataUrlToB64(body.receiptData);
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
      type: receiptB64 ? 'image' : (note ? 'note' : null),
      receiptData: receiptB64 || null,
      url: r.paidReceipt && r.paidReceipt.url ? r.paidReceipt.url : null,
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
});

// ==================== 取消打款标记（误点可撤回）====================
router.post('/records/:id/unpay', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  r.paid = false;
  r.paidAt = null;
  r.paidBy = null;
  await saveData();
  res.json({ success: true, id: r.id, paid: false });
});

module.exports = router;
