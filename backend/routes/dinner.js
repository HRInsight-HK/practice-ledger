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
    // 新逻辑：拼单只有 1 人下单，报销款统一打给下单人；其他成员只核验打卡时间
    const ordererIdxParsed = parseInt(body.ordererIdx, 10);
    const ordererIdx = Number.isInteger(ordererIdxParsed) && ordererIdxParsed >= 0 && ordererIdxParsed < members.length
      ? ordererIdxParsed : 0;

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

    // 逐人校验（支付宝只收下单人的，其他人只验姓名与打卡图）
    const names = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i] || {};
      const nm = String(m.name || '').trim();
      if (!nm) return res.status(400).json({ error: '第 ' + (i + 1) + ' 位同事的姓名未填写' });
      if (names.includes(nm)) return res.status(400).json({ error: '姓名重复：' + nm + '，请检查' });
      names.push(nm);
      if (i === ordererIdx && (!String(m.ali || '').trim() || !String(m.aliname || '').trim())) {
        return res.status(400).json({ error: '请填写下单人 ' + nm + ' 的支付宝账号与实名姓名（报销款统一打给下单人）' });
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
        ali: i === ordererIdx ? String(m.ali).trim() : '',
        aliname: i === ordererIdx ? String(m.aliname).trim() : '',
        isOrderer: i === ordererIdx,          // 新逻辑：报销款统一打给下单人
        ordererName: String((members[ordererIdx] || {}).name || '').trim(),
        groupMembers: names,
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
      matched: false, error: e.message, code, status: e.status || null, imageMissing,
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
  let punchAI = punchBuf ? await vision.recognize(punchBuf, 'punch') : null;
  // 双次识别自检：同一张图再识别一次，两次结果不一致说明识别不稳定 → 转人工
  const doubleCheck = process.env.VISION_DOUBLE_CHECK !== '0';
  const unstable = [];
  const noSpc0 = s => String(s == null ? '' : s).replace(/\s+/g, '');
  if (doubleCheck) {
    if (orderAI && orderBuf) {
      const o2 = await vision.recognize(orderBuf, 'order');
      if (o2.orderTime !== orderAI.orderTime || noSpc0(o2.orderNo) !== noSpc0(orderAI.orderNo)
        || Math.abs((o2.amount || 0) - (orderAI.amount || 0)) > 0.5) {
        unstable.push('订单截图两次识别不一致（下单时间 ' + orderAI.orderTime + ' / ' + o2.orderTime + '），识别不稳定，转人工核验');
      }
    }
    if (punchAI && punchBuf) {
      const p2 = await vision.recognize(punchBuf, 'punch');
      if (p2.punchTime !== punchAI.punchTime || p2.punchDate !== punchAI.punchDate) {
        unstable.push('打卡截图两次识别不一致（' + punchAI.punchTime + ' / ' + p2.punchTime + '），识别不稳定，转人工核验');
      }
    }
  }
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
  // 图片存在性判断要兼容新旧字段（orderImgData/punchImgData = base64 入库；orderImg/punchImg = 旧文件路径）
  // 此前只判旧字段导致比对被整个跳过，AI 提取错时间也会"自动判定一致"
  const hasOrderImg = !!(r.orderImgData || r.orderImg);
  const hasPunchImg = !!(r.punchImgData || r.punchImg);
  if (hasPunchImg) { if (!cmpTime(f.punchTime, ai.punchTime, '打卡时间')) matched = false; if (!cmpTime(f.punchDate, ai.punchDate, '打卡日期')) matched = false; }
  if (hasOrderImg) {
    if (!cmpTime(f.orderTime, ai.orderTime, '下单时间')) matched = false;
    // 订单号识别常带空格分组（如 "3302 2749 ..."），比对前统一去空格
    const noSpc = s => String(s == null ? '' : s).replace(/\s+/g, '');
    if (noSpc(f.orderNo) && noSpc(ai.orderNo) && noSpc(f.orderNo) !== noSpc(ai.orderNo)) { mismatch.push('订单号：员工 ' + f.orderNo + ' / 识别 ' + ai.orderNo); matched = false; }
    if (f.amount && ai.amount && Math.abs(Number(f.amount) - Number(ai.amount)) > 0.5) { mismatch.push('金额：员工 ' + f.amount + ' / 识别 ' + ai.amount); matched = false; }
  }
  // 业务常识校验：识别结果出现以下任一可疑情形时，一律转人工核验，绝不自动判定（防止 AI 读错排班时间等误判直接生效）
  if (ai.orderConfidence != null && ai.orderConfidence < 80) { mismatch.push('订单识别置信度仅 ' + ai.orderConfidence + '%，转人工核验'); matched = false; }
  if (ai.punchConfidence != null && ai.punchConfidence < 80) { mismatch.push('打卡识别置信度仅 ' + ai.punchConfidence + '%，转人工核验'); matched = false; }
  if (ai.punchDate && r.date && ai.punchDate !== r.date) { mismatch.push('识别的打卡日期 ' + ai.punchDate + ' 与用餐日期 ' + r.date + ' 不一致，转人工核验'); matched = false; }
  if (ai.punchTime) {
    const pmin = toMin(ai.punchTime);
    if (pmin != null && pmin < 19 * 60) { mismatch.push('识别的打卡时间 ' + ai.punchTime + ' 早于 19:00，疑似读到了排班时间而非实际打卡，转人工核验'); matched = false; }
    if (ai.orderTime && pmin != null && pmin < toMin(ai.orderTime)) { mismatch.push('打卡时间 ' + ai.punchTime + ' 早于外卖下单时间 ' + ai.orderTime + '，时间逻辑可疑，转人工核验'); matched = false; }
  }
  if (unstable.length) { mismatch.push(...unstable); matched = false; }
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

// ==================== 后台识别队列（顺序 + 限速感知）====================
// 需求：免费模型限速时并发识别会全部 429；改成单条顺序、遇 429 自动停 30 秒再继续。
// 后台内存态保留当前任务；前端轮询 status 看到实时进度，关闭浏览器也能继续。
let _reconJob = {
  active: false, jobId: null,
  queue: [], currentId: null, currentName: null,
  done: 0, success: 0, mismatch: 0, failed: 0, skipped: 0,
  errors: [], log: [],
  startedAt: null, finishedAt: null,
  abortCtl: null
};
function _sleepWithAbort(ms, signal){
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
// 把一条记录按现状处理（用于队列：内部不再二次判状态，逻辑集中到 recognizeOne）
async function _processOne(r, data, ctl){
  if (ctl && ctl.signal && ctl.signal.aborted) throw new Error('aborted');
  const orderBuf = readImgBuffer(r, 'orderImg');
  const punchBuf = readImgBuffer(r, 'punchImg');
  // 图片全丢失：直接转人工
  const orderHas = !!(r.orderImgData || r.orderImg);
  const punchHas = !!(r.punchImgData || r.punchImg);
  if ((orderHas && !orderBuf) || (punchHas && !punchBuf) || (!orderBuf && !punchBuf)) {
    const missing = [];
    if (orderHas && !orderBuf) missing.push('订单图');
    if (punchHas && !punchBuf) missing.push('打卡图');
    r.reviewStatus = 'pendingManual';
    r.verifyInfo = {
      matched: false, code: 'IMAGE_MISSING', imageMissing: true, missing,
      error: '图片已丢失：' + missing.join('、') + '（部署重启清空），请员工重新提交',
      differences: ['图片已丢失，请员工重新提交'],
      decidedAt: new Date().toISOString()
    };
    return { result: 'skipped_image_missing' };
  }
  const out = await recognizeOne(data, r);
  return { result: out.matched ? 'matched' : 'mismatch', out };
}
router.post('/recognize-queue/start', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  if (_reconJob.active) {
    return res.json({ success: false, error: '已有识别任务在进行（jobId ' + _reconJob.jobId + '，已处理 ' + _reconJob.done + '/' + _reconJob.queue.length + '）', status: _queueStatusPublic() });
  }
  const data = getData();
  const targets = (data.dinnerRecords || []).filter(r =>
    r.reviewStatus === 'pendingVerify' || r.reviewStatus === 'pendingManual');
  if (!targets.length) return res.json({ success: false, error: '没有待识别的记录' });

  _reconJob = {
    active: true,
    jobId: 'Q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase(),
    queue: targets.map(r => r.id),
    currentId: null, currentName: null,
    done: 0, success: 0, mismatch: 0, failed: 0, skipped: 0,
    errors: [], log: [{ ts: new Date().toISOString(), msg: '任务启动，共 ' + targets.length + ' 条' }],
    startedAt: new Date().toISOString(), finishedAt: null,
    abortCtl: new AbortController()
  };

  // 后台执行（异步、不阻塞响应）
  (async () => {
    for (const id of _reconJob.queue) {
      const ctlSignal = _reconJob.abortCtl && _reconJob.abortCtl.signal;
      if (ctlSignal && ctlSignal.aborted) break;
      _reconJob.currentId = id;
      const rec = (data.dinnerRecords || []).find(x => x.id === id);
      if (!rec) { _reconJob.failed++; _reconJob.done++; continue; }
      _reconJob.currentName = rec.name;
      _reconJob.log.push({ ts: new Date().toISOString(), id, name: rec.name, action: 'start' });
      // 已通过/已驳回 —— 跳过（防御：用户可能在队列运行中并发了单条识别）
      if (rec.reviewStatus === 'verified' || rec.reviewStatus === 'rejected') {
        _reconJob.skipped++; _reconJob.done++;
        _reconJob.log.push({ ts: new Date().toISOString(), id, action: 'skip_done' });
        continue;
      }
      try {
        const out = await _processOne(rec, data, _reconJob.abortCtl);
        await saveData();
        if (out.result === 'matched') _reconJob.success++;
        else if (out.result === 'mismatch') _reconJob.mismatch++;
        else _reconJob.skipped++;
        _reconJob.log.push({ ts: new Date().toISOString(), id, name: rec.name, action: 'ok', kind: out.result });
      } catch (e) {
        const code = e.code || 'VISION_ERROR';
        const status = e.status || null;
        const aborted = e.message === 'aborted';
        _reconJob.errors.push({ id, name: rec.name, code, status, error: e.message });
        _reconJob.log.push({ ts: new Date().toISOString(), id, name: rec.name, action: 'fail', code, status, aborted });
        if (aborted) break;
        // 限速：等 30 秒再进入下一条（智谱免费额度冷却通常 30-60s）
        if (code === 'VISION_API_ERROR' && status === 429) {
          _reconJob.log.push({ ts: new Date().toISOString(), msg: '检测到限速（429），自动等候 30 秒再继续' });
          try { await _sleepWithAbort(30000, _reconJob.abortCtl.signal); }
          catch (_) { break; }
        }
        await saveData().catch(() => {});
        _reconJob.failed++;
      }
      _reconJob.done++;
      // 条间间隔：避免下一条立即又撞上限速（智谱免费模型通常 1-2 QPS）
      if (!(_reconJob.abortCtl.signal && _reconJob.abortCtl.signal.aborted)) {
        try { await _sleepWithAbort(2500, _reconJob.abortCtl.signal); }
        catch (_) { break; }
      }
    }
    _reconJob.active = false;
    _reconJob.currentId = null;
    _reconJob.currentName = null;
    _reconJob.finishedAt = new Date().toISOString();
    _reconJob.log.push({ ts: new Date().toISOString(), msg: '任务结束：成功 ' + _reconJob.success + ' / 差异转人工 ' + _reconJob.mismatch + ' / 失败 ' + _reconJob.failed + ' / 跳过 ' + _reconJob.skipped });
  })().catch(e => {
    _reconJob.active = false;
    _reconJob.errors.push({ id: null, name: '(queue)', code: 'QUEUE', error: e.message });
    _reconJob.finishedAt = new Date().toISOString();
  });

  res.json({ success: true, jobId: _reconJob.jobId, total: _reconJob.queue.length });
});
function _queueStatusPublic(){
  const data = getData();
  const cur = (_reconJob.currentId && (data.dinnerRecords || []).find(x => x.id === _reconJob.currentId)) || null;
  return {
    active: _reconJob.active,
    jobId: _reconJob.jobId,
    total: _reconJob.queue.length,
    done: _reconJob.done,
    success: _reconJob.success,
    mismatch: _reconJob.mismatch,
    failed: _reconJob.failed,
    skipped: _reconJob.skipped,
    currentId: _reconJob.currentId,
    currentName: cur ? cur.name : (_reconJob.currentName || null),
    startedAt: _reconJob.startedAt,
    finishedAt: _reconJob.finishedAt,
    errors: _reconJob.errors.slice(-20),
    log: _reconJob.log.slice(-30)
  };
}
router.get('/recognize-queue/status', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  res.json(_queueStatusPublic());
});
router.post('/recognize-queue/stop', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  if (!_reconJob.active) return res.json({ success: false, error: '没有正在进行的识别任务', status: _queueStatusPublic() });
  if (_reconJob.abortCtl) _reconJob.abortCtl.abort();
  _reconJob.active = false;
  _reconJob.finishedAt = new Date().toISOString();
  res.json({ success: true, stopped: true, status: _queueStatusPublic() });
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
  // 新逻辑：拼单报销款统一打给下单人，非下单人记录不能单独打款（优先于状态校验，提示更清晰）
  if (r.isOrderer === false && r.groupNo) {
    const orderer = (data.dinnerRecords || []).find(x => x.groupNo === r.groupNo && x.isOrderer === true);
    return res.status(400).json({
      error: '拼单记录打款统一走下单人 ' + (r.ordererName || (orderer && orderer.name) || '') +
        '，请在下单人那一行点「💰 打款（整单）」'
    });
  }
  if (!r.status || !r.status.startsWith('PASS')) return res.status(400).json({ error: '仅通过的记录可标记打款' });
  const body = req.body || {};
  const note = String(body.note || '').toString().trim();
  const receiptB64 = dataUrlToB64(body.receiptData);
  const now = new Date().toISOString();
  const batchId = r.paidBatchId || ('B' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'));
  // 下单人打款 = 整单一起结（同单已核验通过且未打款的成员记录全部标记）
  const groupTargets = (r.isOrderer === true && r.groupNo)
    ? (data.dinnerRecords || []).filter(x => x.groupNo === r.groupNo
        && (!x.paid) && x.status && x.status.startsWith('PASS'))
    : [r];
  for (const g of groupTargets) {
    g.paid = true;
    g.paidAt = now;
    g.paidBatchId = batchId;
    g.paidReceipt = {
      type: receiptB64 ? 'image' : (note ? 'note' : null),
      receiptData: receiptB64 || null,   // 持久化凭证（base64）
      url: g.paidReceipt && g.paidReceipt.url ? g.paidReceipt.url : null,  // 兼容旧记录
      note: note || ''
    };
    g.paidBy = req.user.username;
  }
  await saveData();
  res.json({
    success: true, id: r.id, paid: true, paidAt: now, paidBatchId: batchId,
    paidCount: groupTargets.length,
    totalAmount: Math.round(groupTargets.reduce((s, g) => s + g.amount, 0) * 10) / 10
  });
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
  const includedIds = new Set();   // 拼单整单打款去重
  for (const id of ids) {
    const r = (data.dinnerRecords || []).find(x => x.id === id);
    if (!r) { skipped.push({ id, reason: '记录不存在' }); continue; }
    if (!r.status || !r.status.startsWith('PASS')) { skipped.push({ id, reason: '非通过记录' }); continue; }
    // 新逻辑：非下单人的拼单记录不能单独打款（统一走下单人整单打款）
    if (r.isOrderer === false && r.groupNo) {
      skipped.push({ id, reason: '拼单打款统一走下单人 ' + (r.ordererName || '') + ' 那一行' });
      continue;
    }
    // 下单人 = 整单一起结（同单已核验通过且未打款的成员记录全部标记）
    const groupTargets = (r.isOrderer === true && r.groupNo)
      ? (data.dinnerRecords || []).filter(x => x.groupNo === r.groupNo
          && (!x.paid) && x.status && x.status.startsWith('PASS'))
      : [r];
    for (const g of groupTargets) {
      if (includedIds.has(g.id)) continue;   // 已被同单其他记录带过
      if (g.paid) continue;
      g.paid = true;
      g.paidAt = now;
      g.paidBatchId = batchId;
      g.paidReceipt = {
        type: receiptB64 ? 'image' : (note ? 'note' : null),
        receiptData: receiptB64 || null,
        url: g.paidReceipt && g.paidReceipt.url ? g.paidReceipt.url : null,
        note: note || ''
      };
      g.paidBy = req.user.username;
      includedIds.add(g.id);
      updated.push({ id: g.id, amount: g.amount });
    }
  }
  await saveData();
  res.json({
    success: true, batchId, paidCount: updated.length,
    totalAmount: updated.reduce((s, x) => s + x.amount, 0),
    skipped
  });
});

// ==================== 取消打款标记（误点可撤回；拼单整单撤）====================
router.post('/records/:id/unpay', authMiddleware, requireRole('admin', 'hr'), async (req, res) => {
  const data = getData();
  const r = (data.dinnerRecords || []).find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: '记录不存在' });
  // 新式拼单（isOrderer 已定义）整单一起撤；旧记录保持单条撤回
  const targets = (r.groupNo && r.isOrderer !== undefined)
    ? (data.dinnerRecords || []).filter(x => x.groupNo === r.groupNo && x.paid)
    : [r];
  for (const g of targets) {
    g.paid = false;
    g.paidAt = null;
    g.paidBy = null;
  }
  await saveData();
  res.json({ success: true, id: r.id, paid: false, unpayCount: targets.length });
});

// ==================== 导出 Excel（每周归档，防数据膨胀）====================
// 三个 sheet：台账明细（不含 base64 图片，体积小）/ 周汇总 / 待打款清单（按收款人聚合）
router.get('/export', authMiddleware, requireRole('admin', 'hr'), (req, res) => {
  const XLSX = require('xlsx');
  const data = getData();
  const list = (data.dinnerRecords || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const RV_TXT = { pendingVerify: '待识别', pendingManual: '待人工审核', verified: '已核验', rejected: '已驳回' };
  const ST_TXT = { PASS_A: '通过(通道A)', PASS_B: '通过(通道B)', PASS_CAPPED: '通过(封顶)',
    FAIL_BLUR: '不通过(要素缺失)', FAIL_DATE: '不通过(日期不符)', FAIL_DUP: '不通过(重复)',
    FAIL_TIME: '不通过(时间不符)', FAIL_WEEKCAP: '不通过(周满)', FAIL_ORDERCAP: '不通过(单满)', FAIL_MANUAL: '人工驳回' };

  // ---- Sheet1 台账明细 ----
  const detail = [['提交时间', '姓名', '角色', '拼单人员', '一级部门', '二级部门', '用餐日期',
    '下单时间(填写)', '打卡时间(填写)', '订单号(填写)', '实付(填写)',
    '下单时间(识别)', '打卡时间(识别)', '订单号(识别)', '实付(识别)',
    '核验状态', '判定', '可报金额', '已打款', '打款时间', '打款批次', '收款支付宝', '收款实名', '原因/说明']];
  for (const r of list) {
    const f = r.fields || {}, a = r.ai || {};
    detail.push([
      (r.createdAt || '').replace('T', ' ').slice(0, 16),
      r.name,
      r.isOrderer === true ? '下单人' : (r.isOrderer === false ? '拼单成员' : '—'),
      (r.groupMembers || []).join('、'),
      r.dept1 || '', r.dept2 || '', r.date || '',
      f.orderTime || '', f.punchTime || '', f.orderNo || '', f.amount || '',
      a.orderTime || '', a.punchTime || '', a.orderNo || '', a.amount || '',
      RV_TXT[r.reviewStatus] || r.reviewStatus || '—',
      ST_TXT[r.status] || r.status || '—',
      r.amount > 0 ? r.amount : 0,
      r.paid ? '是' : '否',
      r.paidAt ? r.paidAt.replace('T', ' ').slice(0, 16) : '',
      r.paidBatchId || '',
      r.ali || '', r.aliname || '',
      r.reason || (r.verifyInfo && r.verifyInfo.differences ? r.verifyInfo.differences.join('；') : '')
    ]);
  }

  // ---- Sheet2 周汇总（按人按周）----
  const mondayOf = d => { const dt = new Date(d + 'T00:00:00'); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); return dt.toISOString().slice(0, 10); };
  const weeklyMap = {};
  for (const r of list) {
    if (!r.date) continue;
    const wk = mondayOf(r.date);
    const key = r.name + '|' + wk;
    if (!weeklyMap[key]) weeklyMap[key] = { name: r.name, week: wk, passN: 0, total: 0, paid: 0, unpaid: 0 };
    const w = weeklyMap[key];
    if (r.status && r.status.startsWith('PASS')) {
      w.passN++; w.total += r.amount;
      if (r.paid) w.paid += r.amount; else w.unpaid += r.amount;
    }
  }
  const weekly = [['姓名', '所在周(周一)', '通过笔数', '累计可报', '已打款', '待打款']]
    .concat(Object.values(weeklyMap).sort((a, b) => (a.week + a.name).localeCompare(b.week + b.name))
      .map(w => [w.name, w.week, w.passN, Math.round(w.total * 10) / 10, Math.round(w.paid * 10) / 10, Math.round(w.unpaid * 10) / 10]));

  // ---- Sheet3 待打款清单（按收款人聚合；拼单打给下单人）----
  const payMap = {};
  const order = [];
  for (const r of list) {
    if (!r.status || !r.status.startsWith('PASS') || r.paid) continue;
    const isGroup = r.groupNo && r.isOrderer !== undefined;
    if (isGroup && r.isOrderer === false) continue;   // 非下单人跳过（随下单人整单打）
    const key = (r.ali || '') + '|' + (r.aliname || r.name);
    if (!payMap[key]) { payMap[key] = { ali: r.ali || '(未填)', aliname: r.aliname || r.name, n: 0, amt: 0, dates: [] }; order.push(key); }
    const p = payMap[key];
    p.n++; p.amt += r.amount; if (r.date) p.dates.push(r.date);
    // 拼单：整单成员的可报金额都归到下单人
    if (isGroup && r.isOrderer === true) {
      for (const g of list) {
        if (g.groupNo === r.groupNo && g.id !== r.id && g.status && g.status.startsWith('PASS') && !g.paid) {
          p.n++; p.amt += g.amount; if (g.date) p.dates.push(g.date);
        }
      }
    }
  }
  const pending = [['收款人', '支付宝账号', '笔数', '合计金额', '涉及日期']]
    .concat(order.map(k => { const p = payMap[k];
      return [p.aliname, p.ali, p.n, Math.round(p.amt * 10) / 10, [...new Set(p.dates)].sort().join('、')]; }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), '台账明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weekly), '周汇总');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pending), '待打款清单');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = '晚餐报销台账_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(fname));
  res.send(buf);
});

module.exports = router;
