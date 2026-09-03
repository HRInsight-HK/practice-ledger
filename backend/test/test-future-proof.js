// E2E：识别防错三层保险（全部针对"AI 识别错 → 绝不能自动下结论"）
// 三层：① 员工填写 vs 识别交叉比对 ② 双次识别自检（两次结果不一致→人工）
//       ③ 业务常识校验（置信度低/日期不符/打卡<19:00 疑似排班时间/打卡早于下单 → 人工）
// 运行：MOCK_VISION=1 MOCK_FILE=<本目录 mock-future.json>，端口 3459
const http = require('http');
const fs = require('fs');
const path = require('path');

const MOCK = path.join(__dirname, 'mock-future.json');
const writeMock = (obj) => fs.writeFileSync(MOCK, JSON.stringify(obj));

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request('http://127.0.0.1:3459' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const ok = name => console.log('✅', name);
const fail = (name, extra) => { console.log('❌', name, extra || ''); process.exitCode = 1; };

(async () => {
  const fakeImg = 'data:image/jpeg;base64,' + Buffer.alloc(200, 65).toString('base64');
  // 提交并识别一条记录。mOverride 覆盖员工填写字段，mockP/mockO 为打卡/订单的识别序列（[第1次, 第2次]）
  const run = async (name, fields, mockP, mockO) => {
    writeMock({ punch: mockP, order: mockO });
    let res = await req('POST', '/api/dinner/group', {
      date: fields.date || '2026-08-28', dept1: '测试部', sharedCount: 1, ordererIdx: 0,
      orderTime: fields.orderTime || '19:42', orderNo: fields.orderNo || 'MT-FP-001', amount: fields.amount || 46.5,
      orderData: fakeImg, punchData: [fakeImg],
      members: [{
        name, punchTime: fields.punchTime, punchDate: fields.punchDate || fields.date || '2026-08-28',
        orderTime: fields.orderTime || '19:42', orderNo: fields.orderNo || 'MT-FP-001', amount: fields.amount || 46.5,
        ali: name + '@x.com', aliname: '测试'
      }]
    });
    let j = JSON.parse(res.body);
    if (!(res.status === 200 && j.success && j.groupNo)) { fail('提交失败:' + name, res.body.toString().slice(0, 300)); return null; }
    // 登录后触发识别
    const lr = await req('POST', '/api/auth/login', { username: 'admin', password: 'Zz741852' });
    const H = { Authorization: 'Bearer ' + JSON.parse(lr.body).token };
    const recs = JSON.parse((await req('GET', '/api/dinner/records', null, H)).body).records;
    const rec = recs.find(x => x.groupNo === j.groupNo);
    res = await req('POST', '/api/dinner/records/' + rec.id + '/recognize', null, H);
    return { H, id: rec.id, j: JSON.parse(res.body) };
  };
  const P = (t, d, c) => ({ punchTime: t, punchDate: d, confidence: c == null ? 95 : c });
  const O = (t, no, a, c) => ({ orderTime: t, doneTime: t, orderNo: no, amount: a, confidence: c == null ? 95 : c });

  // S1 正常：识别两遍一致 + 填写一致 + 常识通过 → 自动 verified PASS
  let r = await run('正常员', { punchTime: '21:10' }, [P('21:10', '2026-08-28'), P('21:10', '2026-08-28')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'verified' && /^PASS/.test(r.j.status || '')) ok('S1 正常记录 → 自动判定 PASS');
  else if (r) fail('S1 正常记录未自动通过', JSON.stringify(r.j).slice(0, 400));

  // S2 双次识别不一致（21:10 / 18:30）→ 转人工
  r = await run('不稳员', { punchTime: '21:10' }, [P('21:10', '2026-08-28'), P('18:30', '2026-08-28')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('两次识别不一致')) ok('S2 两次识别不一致 → 转人工');
  else if (r) fail('S2 未转人工', JSON.stringify(r.j).slice(0, 400));

  // S3 AI 和员工都读到排班时间 18:30（最危险的旧 bug 场景）→ 常识校验拦截，转人工（修复前会自动 FAIL_TIME）
  r = await run('排班员', { punchTime: '18:30' }, [P('18:30', '2026-08-28'), P('18:30', '2026-08-28')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('疑似')) ok('S3 打卡<19:00 疑似排班时间 → 转人工（不再自动 FAIL）');
  else if (r) fail('S3 未被常识校验拦截', JSON.stringify(r.j).slice(0, 400));

  // S4 打卡日期与用餐日期不符 → 转人工（修复前自动 FAIL_DATE）
  r = await run('日期员', { punchTime: '21:10', date: '2026-08-28' }, [P('21:10', '2026-08-27'), P('21:10', '2026-08-27')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('不一致')) ok('S4 打卡日期与用餐日期不符 → 转人工（不再自动 FAIL_DATE）');
  else if (r) fail('S4 未转人工', JSON.stringify(r.j).slice(0, 400));

  // S5 识别置信度低（60%）→ 转人工
  r = await run('低信员', { punchTime: '21:10' }, [P('21:10', '2026-08-28', 60), P('21:10', '2026-08-28', 60)], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('置信度')) ok('S5 置信度低于 80% → 转人工');
  else if (r) fail('S5 未转人工', JSON.stringify(r.j).slice(0, 400));

  // S6 打卡时间早于下单时间（时间逻辑可疑）→ 转人工
  r = await run('早退员', { punchTime: '19:10' }, [P('19:10', '2026-08-28'), P('19:10', '2026-08-28')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('早于')) ok('S6 打卡早于下单 → 转人工');
  else if (r) fail('S6 未转人工', JSON.stringify(r.j).slice(0, 400));

  // S7 员工填写与识别不一致（21:53 vs 21:10）→ 转人工（回归）
  r = await run('错位员', { punchTime: '21:53' }, [P('21:10', '2026-08-28'), P('21:10', '2026-08-28')], [O('19:42', 'MT-FP-001', 46.5), O('19:42', 'MT-FP-001', 46.5)]);
  if (r && r.j.reviewStatus === 'pendingManual' && JSON.stringify(r.j.differences || []).includes('打卡时间')) ok('S7 填写与识别不一致 → 转人工（回归通过）');
  else if (r) fail('S7 未转人工', JSON.stringify(r.j).slice(0, 400));

  // 清理
  const all = JSON.parse((await req('GET', '/api/dinner/records', null, (r && r.H) || {})).body).records;
  for (const x of all) await req('DELETE', '/api/dinner/records/' + x.id, null, (r && r.H) || {});
  try { fs.unlinkSync(MOCK); } catch (e) {}
  ok('测试数据已清理（' + all.length + ' 条）');
  console.log(process.exitCode ? '\n有失败项' : '\n全部通过');
})();
