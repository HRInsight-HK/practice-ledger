// 视觉识别模块（OpenAI 兼容协议）
// 支持：OpenAI / 智谱 GLM-4V / 通义千问 Qwen-VL / 豆包(火山方舟) / 腾讯混元 等
// 切换厂商只需改环境变量：VISION_BASE_URL / VISION_API_KEY / VISION_MODEL

const ORDER_PROMPT = `你是报销单据信息提取助手。请从这张外卖订单截图中提取字段，只返回 JSON，不要输出其他文字。

字段说明：
- orderTime：外卖下单时间，字符串，HH:MM 24小时制
- doneTime：订单完成或送达时间，字符串，HH:MM；没有就填 orderTime
- orderNo：订单号，字符串
- amount：实付金额，数字（不要带货币符号）
- confidence：识别置信度，0 到 100 的整数

返回格式示例：
{"orderTime":"19:42","doneTime":"20:05","orderNo":"MT20260828A102","amount":23.5,"confidence":92}

看不清或不存在的字段填 null。只返回这一行 JSON。`;

const PUNCH_PROMPT = `你是企业微信「打卡」-「统计」页面的字段提取助手。请从这张下班打卡截图中提取字段，只返回 JSON，不要输出任何其他文字。

【页面布局】这张截图通常是「我的统计」-「日」视图，最重要的「上下班打卡」卡片里：
- 左侧「大数字」（如 09:15 / 18:30 / 10:00 / 19:15）是【班次/排班时间】，**不是实际打卡时间，绝对不能提取**
- 右侧「小字描述」才是实际打卡记录，格式形如：
  * 上班:「正常 (08:58)」「迟到 (09:37)」「考勤机、正常 (21:53)」
  * 下班:「考勤机、正常 (21:53)」「正常 (18:05)」
  真正要的时间，是这些小字【括号内】的 HH:MM

【提取规则】
- punchDate：截图标题里的月份+选中的日历日，例如「2026年8月」+ 选中的「27」→ 2026-08-27
- punchTime：当日「下班」条目里小字括号内的时间，HH:MM 24小时制
  - 当天若有多个下班打卡段（午休进出、外出再回），一律取最晚一条
- confidence：0 到 100 的整数

【示例】截图显示「2026年8月 日历选 27」+「上下班打卡」卡片：上班 09:15 / 正常 (09:37)，下班 18:30 / 考勤机、正常 (21:53)
正确输出：{"punchDate":"2026-08-27","punchTime":"21:53","confidence":95}

【反例】绝不能输出 18:30 或 09:15 这类左侧大数字。
看不清或不存在填 null。只返回这一行 JSON。`;

function parseJsonSafe(text) {
  if (!text) return null;
  let s = String(text).trim();
  if (!s) return null;

  // 1) 去掉最外层 markdown 代码围栏（```json ... ``` / ``` ... ```）
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 2) 优先尝试直接解析整段（标准情形：模型纯 JSON 输出）
  try { return JSON.parse(s); } catch (e) {}

  // 3) 抽取第一对最外层 { ... }（处理模型先写一句"以下是..."再写 JSON 的情形）
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sub = s.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(sub); } catch (e) {}
  }

  // 4) 暴力清洗：去掉模型常见的解释文本前缀（"好的，以下是..."/"根据图片..."/"Here is the JSON:"等）
  //    然后再做一次 { ... } 抽取
  const cleaned = s
    .replace(/^(好的|以下是|根据图片|根据所给|根据提供|这是|答案|输出|Json|JSON|Result|结果)[:：]?[^\n]*\n+/i, '')
    .replace(/^[^\n{]*?(?=[\n{])/, '')
    .trim();
  if (cleaned !== s) {
    try { return JSON.parse(cleaned); } catch (e) {}
    const b1 = cleaned.indexOf('{');
    const b2 = cleaned.lastIndexOf('}');
    if (b1 !== -1 && b2 > b1) {
      try { return JSON.parse(cleaned.slice(b1, b2 + 1)); } catch (e) {}
    }
  }

  // 5) 全部失败 → 返回 null
  return null;
}

function normTime(t) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

function normDate(d) {
  if (!d) return null;
  let s = String(d).trim();
  // 支持 2026/8/28、2026-8-28、2026年8月28日
  let m = s.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/);
  if (m) {
    const y = m[1], mo = String(m[2]).padStart(2, '0'), da = String(m[3]).padStart(2, '0');
    return y + '-' + mo + '-' + da;
  }
  return null;
}

// 默认：智谱 GLM 免费视觉模型（glm-4.6v-flash 永久免费）
// 换厂商只需改环境变量：VISION_BASE_URL / VISION_API_KEY / VISION_MODEL
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4.6v-flash';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function recognize(imageBuffer, kind) {
  // 测试模式：MOCK_VISION=1 返回正常；MOCK_VISION=2 第一次返回坏 JSON（模拟限速），走自纠错重试
  if (process.env.MOCK_VISION === '1') {
    return kind === 'punch'
      ? { model: 'mock', confidence: 95, punchDate: '2026-08-28', punchTime: '21:10', raw: { punchDate: '2026-08-28', punchTime: '21:10' } }
      : { model: 'mock', confidence: 95, orderTime: '19:42', doneTime: '20:05', orderNo: 'MT20260828A102', amount: 46.5, raw: { orderTime: '19:42', orderNo: 'MT20260828A102', amount: 46.5 } };
  }
  // MOCK_VISION=2：模拟智谱限速（第一次返回坏 JSON），验证自纠错重试能救回
  if (process.env.MOCK_VISION === '2') {
    let callCount = 0;
    global.fetch = async function(url, opts) {
      callCount++;
      // 第 1 次：返回坏 JSON（模拟限速时模型输出混乱）
      if (callCount === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '好的，让我看看图片... 这是识别说明。' } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // 第 2 次（重答）：返回 JSON
      const ok = kind === 'punch'
        ? { punchDate: '2026-08-28', punchTime: '21:10', confidence: 95 }
        : { orderTime: '19:42', doneTime: '20:05', orderNo: 'MT20260828A102', amount: 46.5, confidence: 95 };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ok) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    process.env.VISION_API_KEY = process.env.VISION_API_KEY || 'MOCK_KEY_FOR_TEST';
  }
  const apiKey = process.env.VISION_API_KEY;
  const baseUrl = process.env.VISION_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    const err = new Error('未配置视觉识别服务（VISION_API_KEY 为空），请联系管理员');
    err.code = 'NO_VISION_KEY';
    throw err;
  }

  const prompt = kind === 'punch' ? PUNCH_PROMPT : ORDER_PROMPT;
  const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');

  const makeBody = (p) => ({
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: p },
      { type: 'image_url', image_url: { url: dataUrl } }
    ]}],
    temperature: 0,
    max_tokens: 500
  });
  const body = makeBody(prompt);
  const strictPrompt = '只看图，严格只输出 JSON：{"orderTime":"HH:MM","doneTime":"HH:MM","orderNo":"string","amount":number,"confidence":0-100}（punch 类型为 {"punchDate":"YYYY-MM-DD","punchTime":"HH:MM","confidence":0-100}）。字段看不清就 null。无任何解释、Markdown、前缀。';
  const strictBody = makeBody(strictPrompt);

  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  // 免费模型有限速且高峰期会持续返回 429/1305，甚至返回 200 但 content 为空（高负载空响应）。
  // 统一视为「繁忙」，采用更长退避：2s → 4s → 8s → 12s，最多 5 次。
  const BACKOFFS = [2000, 4000, 8000, 12000];

  // 发一次请求，返回 { content } / { busy } / { error }；429、503、200空content 都视为 busy
  const callOnce = async (bdy) => {
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(bdy)
    });
    if (resp.status === 429 || resp.status === 503) return { busy: true, status: resp.status };
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      let msg = '视觉识别服务返回错误 ' + resp.status;
      if (resp.status === 401) msg = '视觉识别密钥无效，请联系管理员检查配置';
      else msg += '：' + txt.slice(0, 200);
      const err = new Error(msg);
      err.code = 'VISION_API_ERROR';
      err.status = resp.status;
      return { error: err };
    }
    const json = await resp.json().catch(() => null);
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content || !String(content).trim()) return { busy: true, status: 200, empty: true };
    return { content: String(content) };
  };

  // 对一次识别做退避重试；连续 busy 时尝试切严格 prompt
  let lastBusy = null;
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    const useStrict = attempt >= 2;
    const r = await callOnce(useStrict ? strictBody : body);
    if (r.error) throw r.error;
    if (r.busy) {
      lastBusy = r;
      if (attempt < BACKOFFS.length) await sleep(BACKOFFS[attempt]);
      continue;
    }
    const parsed = parseJsonSafe(r.content);
    if (!parsed) {
      const strictParsed = await tryStrict(strictBody);
      if (strictParsed) return buildResult(model, kind, strictParsed);
      const preview = r.content.replace(/\s+/g, ' ').slice(0, 120);
      const err = new Error('识别结果不是有效 JSON（智谱可能限速或繁忙）。原始返回：' + preview);
      err.code = 'VISION_PARSE_FAIL';
      err.raw = r.content.slice(0, 500);
      throw err;
    }
    return buildResult(model, kind, parsed);
  }

  const err = new Error(lastBusy && lastBusy.status === 429
    ? '识别请求过于频繁（免费额度限速），请稍候 10 秒后重试'
    : '识别服务繁忙（多次返回空结果），请稍候再试');
  err.code = 'VISION_API_ERROR';
  err.status = lastBusy ? lastBusy.status : 503;
  throw err;
}

// 严格 prompt 自纠错重答（最多 2 次；429/空content 时小退避）
async function tryStrict(strictBody) {
  const url = (process.env.VISION_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '') + '/chat/completions';
  const apiKey = process.env.VISION_API_KEY;
  for (let ra = 0; ra < 2; ra++) {
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(strictBody)
      });
    } catch (e) { await sleep(1500); continue; }
    if (resp.status === 429 || resp.status === 503) { if (ra < 1) await sleep(2000); continue; }
    if (!resp.ok) return null;
    const rj = await resp.json().catch(() => null);
    const content = rj && rj.choices && rj.choices[0] && rj.choices[0].message && rj.choices[0].message.content;
    if (!content || !String(content).trim()) { if (ra < 1) await sleep(1500); continue; }
    const parsed = parseJsonSafe(content);
    if (parsed) return parsed;
  }
  return null;
}

// 把解析结果规整成最终识别结果（订单/打卡共用）
function buildResult(model, kind, parsed) {
  const result = { model, confidence: parsed.confidence == null ? null : Number(parsed.confidence), raw: parsed };
  if (kind === 'punch') {
    result.punchDate = normDate(parsed.punchDate);
    result.punchTime = normTime(parsed.punchTime);
    if (!result.punchDate || !result.punchTime) {
      const err = new Error('打卡截图识别不完整，需能看清打卡日期与时间');
      err.code = 'VISION_INCOMPLETE';
      err.partial = result;
      throw err;
    }
  } else {
    result.orderTime = normTime(parsed.orderTime);
    result.doneTime = normTime(parsed.doneTime) || result.orderTime;
    result.orderNo = parsed.orderNo ? String(parsed.orderNo).trim() : null;
    result.amount = parsed.amount == null ? null : Number(String(parsed.amount).replace(/[^\d.]/g, ''));
    if (!result.orderTime || !result.orderNo || !result.amount) {
      const err = new Error('外卖截图识别不完整，需能看清下单时间、订单号、实付金额');
      err.code = 'VISION_INCOMPLETE';
      err.partial = result;
      throw err;
    }
  }
  return result;
}

function configured() {
  return !!process.env.VISION_API_KEY;
}

module.exports = {
  recognize, configured, normTime, normDate, parseJsonSafe,
  DEFAULT_BASE_URL, DEFAULT_MODEL
};
