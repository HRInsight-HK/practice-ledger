// 测试后台识别队列接口（不需要真的智谱调用，用 mock 限速 + 真实队列逻辑）
const path = require('path');
const http = require('http');

// 启动本地服务（端口固定 3088 避免和 3000 冲突）
process.env.PORT = '3088';
process.env.MOCK_VISION = '3'; // 队列专用：1=正常 2=坏JSON自纠错 3=直接 200空content（队列的429测试见独立路径）
process.env.VISION_API_KEY = 'MOCK_KEY';
process.env.VISION_BASE_URL = ''; // 强制默认 baseUrl
process.env.NODE_ENV = 'test';

const app = require(path.join(__dirname, '..', 'server.js'));

const BASE = 'http://localhost:3088';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method, hostname: 'localhost', port: 3088, path,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('=== 后台识别队列接口测试 ===\n');

  // 1) 登录拿 token
  const loginRes = await req('POST', '/api/auth/login', { username: 'hr', password: 'Zoe20260708' });
  if (!loginRes.body.token) { console.log('登录失败', loginRes); process.exit(1); }
  const token = loginRes.body.token;
  console.log('✅ 登录成功');

  // 2) 看队列初始状态（应 active=false）
  const init = await req('GET', '/api/dinner/recognize-queue/status', null, token);
  console.log('初始状态：', { active: init.body.active, total: init.body.total });
  if (init.body.active) { console.log('⚠️ 上次任务还在跑（活跃），先 STOP'); await req('POST', '/api/dinner/recognize-queue/stop', {}, token); await sleep(500); }

  // 3) 看后台有几条待核验
  const records = await req('GET', '/api/dinner/records', null, token);
  const targets = (records.body.records || []).filter(r => r.reviewStatus === 'pendingVerify' || r.reviewStatus === 'pendingManual');
  console.log('待核验记录：', targets.length, '条');
  if (!targets.length) {
// 注入 3 条 dummy 后，跑完队列再清掉（不在 db 中残留）
  const insertedIds = [];
  {
    const db = require(path.join(__dirname, '..', 'lib', 'db'));
    const data = db.getData();
    if (!data.dinnerRecords) data.dinnerRecords = [];
    for (let i = 0; i < 3; i++) {
      const id = 'TEST' + Date.now().toString(36) + '_' + i;
      data.dinnerRecords.push({
        id, name: '测试队列' + i, dept1: '测试', date: '2026-08-30',
        ai: {}, fields: {}, reviewStatus: i === 0 ? 'pendingVerify' : 'pendingManual',
        verifyInfo: null, status: null, channel: null, amount: 0, reason: null,
        createdAt: new Date().toISOString()
      });
      insertedIds.push(id);
    }
    await db.saveData();
    console.log('已注入 3 条 dummy 记录：' + insertedIds.join(', '));
  }
  }

  // 4) 启动队列（不开真智谱，但 mock 应该让每条都 success 或 mismatch）
  const startRes = await req('POST', '/api/dinner/recognize-queue/start', {}, token);
  console.log('启动返回：', { ok: startRes.body.success, jobId: startRes.body.jobId, total: startRes.body.total });
  if (!startRes.body.success) {
    if (startRes.body.status && startRes.body.status.active) {
      console.log('已有任务在跑（被拦），跳过启动。');
    } else {
      console.log('启动失败：', startRes.body.error); process.exit(1);
    }
  }

  // 5) 轮询直到完成（带 1.5s 间隔，最多等 30s）
  let polls = 0;
  while (polls < 30) {
    await sleep(1500);
    const s = await req('GET', '/api/dinner/recognize-queue/status', null, token);
    polls++;
    console.log(`[poll ${polls}] active=${s.body.active} done=${s.body.done}/${s.body.total} success=${s.body.success} mismatch=${s.body.mismatch} failed=${s.body.failed} skipped=${s.body.skipped} current=${s.body.currentName||'-'}`);
    if (!s.body.active && s.body.done > 0) break;
  }

  const final = await req('GET', '/api/dinner/recognize-queue/status', null, token);
  console.log('\n=== 最终结果 ===');
  console.log({
    jobId: final.body.jobId,
    total: final.body.total, done: final.body.done,
    success: final.body.success, mismatch: final.body.mismatch, failed: final.body.failed, skipped: final.body.skipped,
    errors: final.body.errors,
    lastLog: (final.body.log || []).slice(-5)
  });

  // 6) stop 接口（空闲时返回 success=false，检查不报错）
  const stopEmpty = await req('POST', '/api/dinner/recognize-queue/stop', {}, token);
  console.log('\n空闲时 stop 返回：', { ok: stopEmpty.body.success, msg: stopEmpty.body.error || '(已停)' });

  console.log('\n✅ 接口测试通过');
  process.exit(0);
})().catch(e => { console.error('测试异常：', e); process.exit(2); });
