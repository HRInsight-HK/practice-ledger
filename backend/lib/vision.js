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

const PUNCH_PROMPT = `你是考勤打卡信息提取助手。请从这张下班打卡截图中提取字段，只返回 JSON，不要输出其他文字。

字段说明：
- punchDate：打卡日期，字符串，YYYY-MM-DD
- punchTime：打卡时间，字符串，HH:MM 24小时制
- confidence：识别置信度，0 到 100 的整数

返回格式示例：
{"punchDate":"2026-08-28","punchTime":"21:10","confidence":90}

看不清或不存在的字段填 null。只返回这一行 JSON。`;

function parseJsonSafe(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 去掉 markdown 代码围栏
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return null;
  }
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

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    temperature: 0,
    max_tokens: 500
  };

  // 免费模型有限速（智谱约 5–10 次/分钟），遇 429 指数退避重试
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  let resp = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body)
    });
    if (resp.status !== 429 && resp.status !== 503) break;
    if (attempt < 2) await sleep(1200 * Math.pow(2, attempt)); // 1.2s → 2.4s
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    let msg = '视觉识别服务返回错误 ' + resp.status;
    if (resp.status === 429) msg = '识别请求过于频繁（免费额度限速），请稍候 10 秒后重试';
    else if (resp.status === 401) msg = '视觉识别密钥无效，请联系管理员检查配置';
    else msg += '：' + txt.slice(0, 200);
    const err = new Error(msg);
    err.code = 'VISION_API_ERROR';
    err.status = resp.status;
    throw err;
  }

  const json = await resp.json();
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  const parsed = parseJsonSafe(content);
  if (!parsed) {
    const err = new Error('识别结果解析失败，请重新上传清晰截图');
    err.code = 'VISION_PARSE_FAIL';
    err.raw = String(content || '').slice(0, 300);
    throw err;
  }

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
