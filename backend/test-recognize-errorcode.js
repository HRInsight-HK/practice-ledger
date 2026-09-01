// E2E：验证识别失败时，前端 alert 能拿到具体 code+status 给针对性提示
// 场景：智谱持续返回空 content（HTTP 200 但 content 为空）→ 应让前端收到 code=VISION_API_ERROR, status=200
// 这样前端 alert 能区分「限速」「空 content」「解析失败」等不同原因
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.PORT = '3202';
// MOCK_VISION=2 已实现：第一次坏 JSON，第二次成功 — 不是我们要测的
// 这里我们用自定义 hook：所有 callOnce 都返回 200 空

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DB_BAK = path.join(os.tmpdir(), 'db-errcode-' + Date.now() + '.bak');
let hadDb = fs.existsSync(DB_FILE);
if (hadDb) fs.copyFileSync(DB_FILE, DB_BAK);
try { fs.unlinkSync(DB_FILE); } catch (_) {}

function restoreDb() {
  if (hadDb) {
    try { fs.copyFileSync(DB_BAK, DB_FILE); console.log('[restore] db.json 已恢复'); }
    catch (e) { console.log('[restore] 失败:', e.message); }
  } else {
    try { fs.unlinkSync(DB_FILE); } catch (_) {}
  }
}

const fakeDataUrl = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  process.chdir(__dirname);
  process.env.VISION_API_KEY = 'TEST_KEY_FOR_ERRCODE';
  // 只劫持智谱 URL 的 fetch，其它请求走 Node 原生 fetch
  const _origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && /chat\.glm|bigmodel|openapi|vision|智谱/i.test(url)) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: '' } }]  // 空 content
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return _origFetch(url, opts);
  };

  const express = require('express');
  const db = require('./lib/db');
  await db.loadData();
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/dinner', require('./routes/dinner'));
  app.use('/api/auth', require('./routes/auth'));
  const server = app.listen(process.env.PORT);

  const base = 'http://localhost:' + process.env.PORT;

  // 1) 登录
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr', password: 'Zoe20260708' })
  }).then(r => r.json());
  console.log('1) 登录返回:', JSON.stringify(loginRes).slice(0,200));
  console.log('1) 登录 token:', loginRes.token ? 'OK' : 'FAIL');
  const auth = 'Bearer ' + loginRes.token;

  // 2) 提交一条订单（带 orderImgData + punchImgData，走新方案）
  const submit = await fetch(base + '/api/dinner/group', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    body: JSON.stringify({
      groupNo: 'GtestErrCode1',
      date: '2026-09-01',
      dept1: '行政部',
      dept2: '',
      sharedCount: 1,
      members: [{ name: '测试员工', ali: 'test@x', aliname: '测试员' }],
      payerIndex: 0,
      orderData: fakeDataUrl(),
      punchData: [fakeDataUrl()]
    })
  }).then(r => r.json());
  console.log('2) 提交返回:', JSON.stringify(submit).slice(0,300));
  console.log('2) 提交:', submit.success ? 'OK' : 'FAIL', 'groupNo=', submit.groupNo);

  // 3) 列出记录，找到这条
  const list = await fetch(base + '/api/dinner/records', {
    headers: { 'Authorization': auth }
  }).then(r => r.json());
  console.log('3) 列表返回 records 数:', (list.records || []).length);
  const rec = (list.records || []).find(r => r.groupNo === submit.groupNo);
  console.log('3) 找到记录 id:', rec && rec.id, '| 状态:', rec && rec.reviewStatus);

  // 4) 触发识别（应该识别失败：5次都 200 但空 content → 落入 pendingManual）
  const start = Date.now();
  const reco = await fetch(base + '/api/dinner/records/' + rec.id + '/recognize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': auth }
  }).then(r => r.json());
  const dur = Date.now() - start;
  console.log('4) 识别结果:');
  console.log('   success:', reco.success);
  console.log('   reviewStatus:', reco.reviewStatus);
  console.log('   matched:', reco.matched);
  console.log('   error:', (reco.error || '').slice(0, 80));
  console.log('   code:', reco.code);
  console.log('   status:', reco.status);
  console.log('   imageMissing:', reco.imageMissing);
  console.log('   耗时:', dur, 'ms');

  // 5) 验证关键字段
  let pass = true;
  if (reco.success !== false) { console.log('FAIL: success 应该是 false'); pass = false; }
  if (reco.code !== 'VISION_API_ERROR') { console.log('FAIL: code 应该是 VISION_API_ERROR，实际', reco.code); pass = false; }
  if (reco.status !== 200) { console.log('FAIL: status 应该是 200（空 content），实际', reco.status); pass = false; }
  if (reco.imageMissing !== false) { console.log('FAIL: imageMissing 应该是 false'); pass = false; }
  if (reco.reviewStatus !== 'pendingManual') { console.log('FAIL: reviewStatus 应该是 pendingManual'); pass = false; }
  if (dur < 20000) { console.log('FAIL: 5次退避至少 20 秒，实际', dur); pass = false; }

  console.log(pass ? '\n✅ 通过：识别失败返回了 code+status，前端 alert 能针对性提示' : '\n❌ 失败');

  global.fetch = _origFetch;
  server.close();
  restoreDb();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error(e); restoreDb(); process.exit(2); });