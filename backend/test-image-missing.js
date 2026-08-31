// 端到端：验证「图片已丢失」时不再调用智谱，直接降级为待人工
// 复用 base64 测试的基础设施，只覆盖图片丢失分支
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.PORT = '3198';
process.env.MOCK_VISION = '0';   // 关掉 mock，强制走真实网络，从而证明不会走到网络

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DB_BAK = path.join(os.tmpdir(), 'db-missing-' + Date.now() + '.bak');
let hadDb = fs.existsSync(DB_FILE);
if (hadDb) fs.copyFileSync(DB_FILE, DB_BAK);
// 始终删 db.json 让服务重建种子账号
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

const fakeDataUrl = (label) => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  // 直接 require 服务模块（不监听端口）
  process.chdir(__dirname);
  const express = require('express');
  const db = require('./lib/db');
  await db.loadData();   // 先加载数据，再挂路由（避免 getData 抛"尚未加载"）
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  const dinnerRouter = require('./routes/dinner');
  const authRouter = require('./routes/auth');
  app.use('/api/dinner', dinnerRouter);
  app.use('/api/auth', authRouter);
  const server = app.listen(process.env.PORT);

  // 1. 登录拿 token
  let resp = await fetch('http://localhost:' + process.env.PORT + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr', password: 'Zoe20260708' })
  });
  let j = await resp.json();
  if (!resp.ok) throw new Error('登录失败: ' + JSON.stringify(j));
  const token = j.token;
  const auth = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 2. 直接造一条「图片已丢失」的旧记录：orderImg/punchImg 是 URL，但服务启动时临时盘为空 → readImgBuffer 找不到
  //    通过 list 接口插入一条手动数据是不行的，走 getData 写不进去；改用插入到 db.json 内存中
  //    实际：我们直接提交一张极小的图 → 服务把它落库（这次不走，因为新版 base64 存库了）→ 然后清空图字段模拟丢失
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/group', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-08-31', dept1: '测试部', sharedCount: 1,
      orderData: fakeDataUrl('order'),
      punchData: [fakeDataUrl('punch')],
      members: [{ name: '测试丢失', ali: 'a@b', aliname: '测试', punchTime: '21:00', punchDate: '2026-08-31' }]
    })
  });
  j = await resp.json();
  if (!resp.ok) throw new Error('提交失败: ' + JSON.stringify(j));
  console.log('✅ 已造 1 条 base64 存库的测试记录 groupNo=' + j.groupNo);

  // 取记录 id，强制把它的 orderImgData/punchImgData 清掉，模拟「图片丢失」
  const dbMod = require('./lib/db');
  const data = dbMod.getData();
  const rec = (data.dinnerRecords || []).find(r => r.groupNo === j.groupNo);
  if (!rec) throw new Error('未找到测试记录');
  delete rec.orderImgData;
  delete rec.punchImgData;
  rec.orderImg = '/uploads/dinner-proofs/pr_does_not_exist.png';
  rec.punchImg = '/uploads/dinner-proofs/pr_does_not_exist.png';
  await db.saveData();

  // 3. 触发识别 → 应该立刻报 IMAGE_MISSING，不调用智谱
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/records/' + rec.id + '/recognize', {
    method: 'POST', headers: auth
  });
  j = await resp.json();
  console.log('识别返回:', JSON.stringify(j));
  if (j.imageMissing !== true) {
    throw new Error('❌ 应返回 imageMissing=true（实际: ' + JSON.stringify(j) + '）');
  }
  if (!j.error || !j.error.includes('图片已丢失')) {
    throw new Error('❌ 错误信息应包含「图片已丢失」（实际: ' + j.error + '）');
  }
  if (j.reviewStatus !== 'pendingManual') {
    throw new Error('❌ 应转 pendingManual（实际: ' + j.reviewStatus + '）');
  }
  console.log('✅ 图片丢失时正确降级为 pendingManual，未调用智谱');

  // 4. 验证 verifyInfo 标记了 imageMissing
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/records', { headers: auth });
  const recs = (await resp.json()).records;
  const recAfter = recs.find(r => r.id === rec.id);
  if (!recAfter.verifyInfo || !recAfter.verifyInfo.imageMissing) {
    throw new Error('❌ verifyInfo 未标记 imageMissing');
  }
  console.log('✅ verifyInfo.imageMissing=true 已写入数据库');

  // 5. 一键标记接口：再造一条同样的脏数据，验证 /records/mark-image-missing 能批量处理
  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/group', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-08-31', dept1: '测试部', sharedCount: 1,
      orderData: fakeDataUrl('order'),
      punchData: [fakeDataUrl('punch')],
      members: [{ name: '测试批量', ali: 'b@b', aliname: '测试', punchTime: '21:00', punchDate: '2026-08-31' }]
    })
  });
  j = await resp.json();
  if (!resp.ok) throw new Error('提交失败: ' + JSON.stringify(j));
  const d2 = db.getData();
  const r2 = (d2.dinnerRecords || []).find(r => r.groupNo === j.groupNo);
  delete r2.orderImgData;
  delete r2.punchImgData;
  r2.orderImg = '/uploads/dinner-proofs/pr_x.png';
  r2.punchImg = '/uploads/dinner-proofs/pr_x.png';
  await dbMod.saveData();

  resp = await fetch('http://localhost:' + process.env.PORT + '/api/dinner/records/mark-image-missing', {
    method: 'POST', headers: auth
  });
  j = await resp.json();
  console.log('批量标记返回:', JSON.stringify(j));
  if (!j.success || typeof j.updated !== 'number' || j.updated < 1) {
    throw new Error('❌ 批量标记未生效: ' + JSON.stringify(j));
  }
  console.log('✅ 一键标记接口正常，共处理 ' + j.updated + ' 条');

  server.close();
  restoreDb();
  console.log('\n🎉 图片丢失降级测试全部通过！');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ 测试失败:', e.message);
  console.error(e.stack);
  restoreDb();
  process.exit(1);
});

setTimeout(() => {
  console.error('❌ 测试超时');
  restoreDb();
  process.exit(2);
}, 30000);