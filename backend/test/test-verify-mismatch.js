// E2E：修复「比对被跳过」+「AI 提错时间仍自动判定」两个 bug
// 场景：MOCK_VISION=1（mock 识别 punchTime=21:10, orderTime=19:42, orderNo=MT20260828A102, amount=46.5）
// 1) 员工填 18:30（与 mock 21:10 不一致）→ 识别后应转 pendingManual（修复前会错误地"自动判定一致"）
// 2) 员工填 21:10（与 mock 一致）→ 应自动 verified 并 PASS_A
// 3) 员工订单号带空格 vs 识别不带空格 → 订单号不应误报不一致（去空格比对）
const http = require('http');

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request('http://127.0.0.1:3458' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, res => {
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
  const base = {
    date: '2026-08-28', dept1: '测试部', sharedCount: 1, ordererIdx: 0,
    orderTime: '19:42', orderNo: 'MT20260828A102', amount: 46.5,
    orderData: fakeImg
  };
  const submit = async (name, punchTime, orderNoSpaced) => {
    const r = await req('POST', '/api/dinner/group', Object.assign({}, base, {
      orderNo: orderNoSpaced ? 'MT 2026 0828 A102' : 'MT20260828A102',
      punchData: [fakeImg],
      members: [{ name, punchTime, punchDate: '2026-08-28', orderTime: '19:42', orderNo: orderNoSpaced ? 'MT 2026 0828 A102' : 'MT20260828A102', amount: 46.5, ali: name + '@x.com', aliname: '测试' }]
    }));
    const j = JSON.parse(r.body);
    if (!(r.status === 200 && j.success && j.groupNo)) { fail('提交失败:' + name, r.body.toString().slice(0, 300)); return null; }
    return j.groupNo;
  };

  // 登录
  let res = await req('POST', '/api/auth/login', { username: 'admin', password: 'Zz741852' });
  const H = { Authorization: 'Bearer ' + JSON.parse(res.body).token };
  const getIdByGroup = async (g) => {
    const r = await req('GET', '/api/dinner/records', null, H);
    const rec = JSON.parse(r.body).records.find(x => x.groupNo === g);
    return rec ? rec.id : null;
  };

  // ---- 场景 1：员工填打卡 18:30，mock 识别 21:10 → 必须 pendingManual ----
  const g1 = await submit('错位测试员', '18:30', false);
  if (!g1) return;
  const id1 = await getIdByGroup(g1);
  res = await req('POST', '/api/dinner/records/' + id1 + '/recognize', null, H);
  let j = JSON.parse(res.body);
  if (j.reviewStatus === 'pendingManual' && /打卡时间/.test(JSON.stringify(j.differences || []))) ok('场景1：打卡时间不一致 → 转人工审核（修复生效）');
  else return fail('场景1：未转人工', res.body.toString().slice(0, 400));

  // ---- 场景 2：员工填打卡 21:10（与 mock 一致）→ 自动 verified + PASS ----
  const g2 = await submit('一致测试员', '21:10', false);
  const id2 = await getIdByGroup(g2);
  res = await req('POST', '/api/dinner/records/' + id2 + '/recognize', null, H);
  j = JSON.parse(res.body);
  if (j.reviewStatus === 'verified' && /^PASS/.test(j.status || '')) ok('场景2：填写与识别一致 → 自动判定 PASS');
  else fail('场景2失败', res.body.toString().slice(0, 400));

  // ---- 场景 3：订单号员工带空格（mock 识别不带）→ 不应误报订单号不一致 ----
  const g3 = await submit('空格测试员', '21:10', true);
  const id3 = await getIdByGroup(g3);
  res = await req('POST', '/api/dinner/records/' + id3 + '/recognize', null, H);
  j = JSON.parse(res.body);
  const diffs = JSON.stringify(j.differences || []);
  if (j.reviewStatus === 'verified' && !diffs.includes('订单号')) ok('场景3：订单号空格不误报（去空格比对生效）');
  else fail('场景3：订单号被误报不一致', res.body.toString().slice(0, 400));

  // ---- 场景 4（回归）：人工核验 approve 修正打卡时间 → FAIL_TIME 记录可被纠正 ----
  res = await req('POST', '/api/dinner/records/' + id1 + '/manual-review', { action: 'approve', fields: { punchTime: '21:10', punchDate: '2026-08-28', orderTime: '19:42', orderNo: 'MT-ORDERCAP-FIX-999', amount: 46.5 } }, H);
  j = JSON.parse(res.body);
  if (j.reviewStatus === 'verified' && /^PASS/.test(j.status || '')) ok('场景4：人工修正打卡时间后 PASS');
  else fail('场景4失败', res.body.toString().slice(0, 400));

  // 清理测试数据（含 curl 预提交的那条）
  const all = JSON.parse((await req('GET', '/api/dinner/records', null, H)).body).records;
  for (const r of all) await req('DELETE', '/api/dinner/records/' + r.id, null, H);
  ok('测试数据已清理（' + all.length + ' 条）');
  console.log(process.exitCode ? '\n有失败项' : '\n全部通过');
})();
