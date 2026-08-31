// E2E：验证「待人工审核(pendingManual)的记录也能重新识别」——重试识别通道
// 场景：员工提交 → 后台识别转待人工 → SSC 点「🔁 重新识别」→ 这次成功自动判定通过
// 用 MOCK_VISION=1（永远成功），员工填写与 mock 一致 → 应判 verified + PASS
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.PORT = '3201';
process.env.MOCK_VISION = '1';   // 识别永远成功：punchTime=21:10

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DB_BAK = path.join(os.tmpdir(), 'db-retry-' + Date.now() + '.bak');
let hadDb = fs.existsSync(DB_FILE);
if (hadDb) fs.copyFileSync(DB_FILE, DB_BAK);
try { fs.unlinkSync(DB_FILE); } catch (_) {}

let child;
function restoreDb() {
  try { child && child.kill && child.kill(); } catch (_) {}
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
  const express = require('express');
  const db = require('./lib/db');
  await db.loadData();
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/dinner', require('./routes/dinner'));
  app.use('/api/auth', require('./routes/auth'));
  const server = app.listen(process.env.PORT);

  // 登录
  let resp = await fetch('http://localhost:' + process.env.PORT + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr', password: 'Zoe20260708' })
  });
  let j = await resp.json();
  if (!resp.ok) throw new Error('登录失败: ' + JSON.stringify(j));
  const auth = { 'Authorization': 'Bearer ' + j.token, 'Content-Type': 'application/json' };

  // 提交一条记录（员工填写 punchTime 与 mock 一致 21:10）
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/group', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-08-31', dept1: '测试部', sharedCount: 1,
      orderData: fakeDataUrl(),
      punchData: [fakeDataUrl()],
      members: [{ name: '重试测试', ali: 'a@b', aliname: '测试', punchTime: '21:10', punchDate: '2026-08-31' }]
    })
  });
  j = await resp.json();
  if (!resp.ok) throw new Error('提交失败: ' + JSON.stringify(j));
  const rec = (db.getData().dinnerRecords || []).find(r => r.groupNo === j.groupNo);
  if (!rec) throw new Error('未找到测试记录');

  // 人为把它设成 pendingManual（模拟首次识别失败/有差异转待人工）
  rec.reviewStatus = 'pendingManual';
  rec.verifyInfo = { matched: false, code: 'VISION_PARSE_FAIL', error: '识别结果不是有效JSON', differences: ['识别失败：模拟失败'], decidedAt: new Date().toISOString() };
  await db.saveData();
  console.log('✅ 已造待人工记录 id=' + rec.id + ', reviewStatus=' + rec.reviewStatus);

  // 触发重新识别 → 应能识别成功自动通过
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/records/' + rec.id + '/recognize', {
    method: 'POST', headers: auth
  });
  j = await resp.json();
  console.log('重新识别返回:', JSON.stringify(j, null, 2));

  // 断言
  const expectVerified = j.matched === true && j.reviewStatus === 'verified';
  if (!expectVerified) {
    throw new Error('❌ 重新识别应自动判定通过 (matched=true, verified)，实际: ' + JSON.stringify(j));
  }
  console.log('✅ 重新识别成功，记录已从待人工 → ' + j.reviewStatus + '，可报 ' + j.amount + ' 元');

  // 再验证：已 verified 的记录不允许再识别（原保护逻辑不破坏）
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/records/' + rec.id + '/recognize', {
    method: 'POST', headers: auth
  });
  j = await resp.json();
  if (resp.status !== 400) {
    throw new Error('❌ 已核验记录应返回 400，实际状态: ' + resp.status + ' ' + JSON.stringify(j));
  }
  console.log('✅ 已核验记录再识别被正确拦截 (400): ' + j.error);

  server.close();
  console.log('\n🎉 全部断言通过，重新识别通道可用');
}

main().catch(e => { console.error('❌ 测试失败:', e.message); process.exit(1); })
  .finally(() => { try { child && child.kill(); } catch (_) {} restoreDb(); });
