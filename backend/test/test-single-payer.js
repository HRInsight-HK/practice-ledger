// E2E：拼单只收下单人支付宝 + 整单打款 + Excel 导出
const http = require('http');
const fs = require('fs');

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request('http://127.0.0.1:3458' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const ok = name => console.log('✅', name);
const fail = (name, extra) => { console.log('❌', name, extra || ''); process.exitCode = 1; };

(async () => {
  // 1. 2人拼单提交：只有下单人(ordererIdx=1)有支付宝
  const fakeImg = 'data:image/jpeg;base64,' + Buffer.alloc(200, 65).toString('base64');
  let res = await req('POST', '/api/dinner/group', {
    date: '2026-09-01', dept1: '测试部', dept2: '', sharedCount: 2, ordererIdx: 1,
    orderTime: '20:10', doneTime: '20:40', orderNo: 'TEST-ORDER-001', amount: 40,
    orderData: fakeImg,
    punchData: [fakeImg, fakeImg],
    members: [
      { name: '成员甲', punchTime: '21:30', punchDate: '2026-09-01', orderTime: '20:10', orderNo: 'TEST-ORDER-001', amount: 40 },
      { name: '下单人乙', ali: 'test@aliyun.com', aliname: '乙实名', punchTime: '22:00', punchDate: '2026-09-01', orderTime: '20:10', orderNo: 'TEST-ORDER-001', amount: 40 }
    ]
  });
  let j = JSON.parse(res.body);
  if (res.status === 200 && j.success) ok('拼单提交成功（2人，ordererIdx=1）'); else return fail('拼单提交失败', res.body.toString().slice(0, 300));
  const groupNo = j.groupNo;

  // 2. 缺下单人支付宝应报错
  res = await req('POST', '/api/dinner/group', {
    date: '2026-09-01', dept1: '测试部', sharedCount: 2, ordererIdx: 0,
    orderTime: '20:10', orderNo: 'X', amount: 40,
    orderData: fakeImg, punchData: [fakeImg, fakeImg],
    members: [
      { name: '甲', punchTime: '21:00' },
      { name: '乙', punchTime: '22:00', ali: '', aliname: '' }
    ]
  });
  if (res.status === 400 && /下单人/.test(res.body.toString())) ok('缺下单人支付宝被拦截'); else fail('缺支付宝未拦截', res.body.toString().slice(0, 200));

  // 3. 登录拿 token，查记录
  res = await req('POST', '/api/auth/login', { username: 'admin', password: 'Zz741852' });
  const H = { Authorization: 'Bearer ' + JSON.parse(res.body).token };
  res = await req('GET', '/api/dinner/records', null, H);
  const list = JSON.parse(res.body).records.filter(r => r.groupNo === groupNo);
  const orderer = list.find(r => r.isOrderer === true);
  const member = list.find(r => r.isOrderer === false);
  if (list.length === 2 && orderer && member) ok('记录数与 isOrderer 标记正确');
  else return fail('记录结构不对', JSON.stringify(list.map(r => ({ n: r.name, o: r.isOrderer }))));
  if (orderer.ali && !member.ali) ok('支付宝只存在下单人记录上'); else fail('支付宝字段分布错误');
  if (member.ordererName === '下单人乙' && (member.groupMembers || []).length === 2) ok('ordererName/groupMembers 正确'); else fail('ordererName 不对', member.ordererName);

  // 4. 直接对非下单人打款应被拦
  res = await req('POST', '/api/dinner/records/' + member.id + '/pay', { note: 't' }, H);
  if (res.status === 400 && /下单人/.test(res.body.toString())) ok('非下单人单独打款被拦截'); else fail('非下单人打款未拦截', res.body.toString().slice(0, 200));

  // 5. 手工核验两条（走 manual-review 通过，避免依赖智谱）
  for (const r of list) {
    res = await req('POST', '/api/dinner/records/' + r.id + '/manual-review', {
      action: 'approve', fields: {
        orderTime: '20:10', punchTime: r.name === '下单人乙' ? '22:00' : '21:30',
        punchDate: '2026-09-01', orderNo: 'TEST-ORDER-001', amount: 40
      }
    }, H);
    if (res.status !== 200) fail('人工核验失败 ' + r.name, res.body.toString().slice(0, 200));
  }
  res = await req('GET', '/api/dinner/records', null, H);
  const list2 = JSON.parse(res.body).records.filter(r => r.groupNo === groupNo);
  if (list2.every(r => r.reviewStatus === 'verified' && r.status && r.status.startsWith('PASS'))) ok('两条均核验通过');
  else fail('核验状态不对', JSON.stringify(list2.map(r => [r.name, r.reviewStatus, r.status, r.amount])));

  // 6. 对下单人打款 → 整单两条都标记
  res = await req('POST', '/api/dinner/records/' + orderer.id + '/pay', { note: '整单测试' }, H);
  j = JSON.parse(res.body);
  if (res.status === 200 && j.paidCount === 2 && Math.abs(j.totalAmount - 40) < 0.01) ok('下单人打款=整单2条合计40元（人均20封顶内）');
  else fail('整单打款结果不对', res.body.toString().slice(0, 300));
  res = await req('GET', '/api/dinner/records', null, H);
  const list3 = JSON.parse(res.body).records.filter(r => r.groupNo === groupNo);
  if (list3.every(r => r.paid)) ok('整单成员全部标记已打款'); else fail('有成员未标记');
  const total = Math.round(list3.reduce((s, r) => s + r.amount, 0) * 10) / 10;
  if (Math.abs(total - j.totalAmount) < 0.01) ok('打款合计与记录合计一致（' + total + '元）'); else fail('合计不一致', total + ' vs ' + j.totalAmount);

  // 7. Excel 导出
  res = await req('GET', '/api/dinner/export', null, H);
  const ct = res.headers['content-type'] || '';
  if (res.status === 200 && ct.includes('spreadsheetml')) {
    fs.writeFileSync('C:/Users/EDY/AppData/Local/Temp/test-export.xlsx', res.body);
    const XLSX = require('xlsx');
    const wb = XLSX.readFile('C:/Users/EDY/AppData/Local/Temp/test-export.xlsx');
    if (wb.SheetNames.join(',') === '台账明细,周汇总,待打款清单') ok('Excel 三个sheet齐全: ' + wb.SheetNames.join('/'));
    else fail('sheet不对', wb.SheetNames.join(','));
    const detail = XLSX.utils.sheet_to_json(wb.Sheets['台账明细'], { header: 1 });
    if (detail.length >= 3 && detail[1][1] === '成员甲' && detail[2][1] === '下单人乙') ok('明细含两条拼单记录');
    else fail('明细内容不对', JSON.stringify(detail.slice(1, 3)));
    if (!res.body.toString('utf8').includes('data:image')) ok('导出不含 base64 图片（体积安全）'); else fail('导出泄漏了base64');
    const weekly = XLSX.utils.sheet_to_json(wb.Sheets['周汇总'], { header: 1 });
    console.log('   周汇总预览:', JSON.stringify(weekly.slice(1, 3)));
    const pend = XLSX.utils.sheet_to_json(wb.Sheets['待打款清单'], { header: 1 });
    console.log('   待打款行数(应0条已全打款):', pend.length - 1);
  } else fail('Excel导出失败', res.status + ' ' + ct + ' ' + res.body.toString().slice(0, 200));

  // 8. 撤回整单
  res = await req('POST', '/api/dinner/records/' + orderer.id + '/unpay', {}, H);
  j = JSON.parse(res.body);
  res = await req('GET', '/api/dinner/records', null, H);
  const list4 = JSON.parse(res.body).records.filter(r => r.groupNo === groupNo);
  if (j.unpayCount === 2 && list4.every(r => !r.paid)) ok('撤回=整单2条一起撤'); else fail('撤回行为不对', JSON.stringify(list4.map(r => r.paid)));

  console.log('\n=== 测试完成 ===');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
