// 用 Node.js 创建 UTF-8 正确编码的测试记录
const https = require('https');

const BASE = 'https://practice-ledger.onrender.com';

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'practice-ledger.onrender.com',
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== 1. 登录 admin 账号 ===');
  const loginRes = await apiCall('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin123'
  });
  const adminToken = loginRes.token;
  console.log('Admin token:', adminToken ? 'OK' : 'FAIL');

  console.log('\n=== 2. 登录 hr 账号 ===');
  const hrLogin = await apiCall('POST', '/api/auth/login', {
    username: 'hr',
    password: 'hr666'
  });
  const hrToken = hrLogin.token;
  console.log('HR token:', hrToken ? 'OK' : 'FAIL');

  console.log('\n=== 3. 获取现有记录 ===');
  const records = await apiCall('GET', '/api/records', null, hrToken);
  console.log('Records count:', records.length || (records.records && records.records.length) || 0);
  
  // 找到并删除乱码记录
  const recordList = records.records || records;
  for (const r of recordList) {
    console.log('  Found record:', r.id, '- name:', r.name, '- status:', r.status);
    if (r.name && (r.name.includes('???') || r.name.includes('\ufffd') || r.name === '')) {
      console.log('  -> Deleting garbled record:', r.id);
      const delRes = await apiCall('DELETE', '/api/records/' + r.id, null, hrToken);
      console.log('  Delete result:', JSON.stringify(delRes));
    }
  }

  console.log('\n=== 4. 创建正确的测试记录（UTF-8）===');
  // 测试记录：10天实操（>7天），结束日期3天后（触发T-3通知）
  const newRecord = {
    name: '张小明',
    department: '市场部',
    position: '市场专员',
    startDate: '2026-07-21',
    endDate: '2026-07-31',
    mentor: '李组长',
    practiceDays: 10,
    deviceModel: 'MacBook Pro 14'
  };
  console.log('Creating record:', JSON.stringify(newRecord, null, 2));
  const createRes = await apiCall('POST', '/api/records', newRecord, adminToken);
  console.log('Create result:', JSON.stringify(createRes, null, 2));

  console.log('\n=== 5. 手动触发定时检查 ===');
  const triggerRes = await apiCall('GET', '/api/trigger-check');
  console.log('Trigger result:', JSON.stringify(triggerRes, null, 2));

  console.log('\n=== 6. 检查诊断信息 ===');
  const diag = await apiCall('GET', '/api/diagnostic');
  console.log('Diagnostic:', JSON.stringify(diag, null, 2));

  console.log('\n=== 完成！请检查企微群通知 ===');
}

main().catch(e => console.error('Error:', e));
