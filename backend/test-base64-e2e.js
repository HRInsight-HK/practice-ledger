// 端到端测试：验证方案A（图片 base64 存数据库）完整流程
// 用 MOCK_VISION=1（固定返回）避免智谱限速
// 用法：MOCK_VISION=1 node test-base64-e2e.js
process.env.MOCK_VISION = process.env.MOCK_VISION || '1';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 3199;
const BASE = 'http://localhost:' + PORT;

// 测试会写入 data/db.json（文件存储模式），结束后恢复，避免污染。
// 为保证能用种子账号密码登录，测试前临时移除 db.json（备份后），结束后还原。
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const DB_BAK = path.join(os.tmpdir(), 'db-b64e2e-' + Date.now() + '.bak');
let hadDb = fs.existsSync(DB_FILE);
if (hadDb) {
  fs.copyFileSync(DB_FILE, DB_BAK);
  fs.unlinkSync(DB_FILE);   // 让服务用 getDefaultData 重建种子账号
}

// 生成一张测试图（纯色 PNG）作为 dataURL
function fakeDataUrl(kind){
  // 128x128 纯色 PNG base64
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAA' +
    (kind==='order'
      ? 'HUlEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAADmBkCAAAEkTnN4AAAAAElFTkSuQmCC'
      : 'HUlEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAADmBkCAAAEkTnN4AAAAAElFTkSuQmCC');
  return 'data:image/png;base64,' + b64;
}

let child = null;
function startServer(){
  return new Promise((resolve,reject)=>{
    child = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: String(PORT), MOCK_VISION:'1' },
      cwd: __dirname,
      stdio: ['ignore','pipe','pipe']
    });
    let out='';
    child.stdout.on('data', d=>{ out+=d.toString(); if(out.includes('已启动')||out.includes('listening')) resolve(); });
    child.stderr.on('data', d=>{ out+=d.toString(); });
    child.on('exit', ()=>reject(new Error('server exited')));
    setTimeout(()=>reject(new Error('timeout starting server: '+out.slice(-300))), 8000);
  });
}

async function main(){
  await startServer();
  console.log('✅ 服务已启动，开始端到端测试\n');

  // 1. 提交（JSON + dataURL）
  const orderData = fakeDataUrl('order');
  const punchData = fakeDataUrl('punch');
  const payload = {
    date:'2026-08-31', dept1:'技术部', dept2:'后端组', sharedCount:2,
    orderTime:'19:50', doneTime:'20:10', orderNo:'MT20260831X001', amount:52.0,
    orderData,
    punchData:[punchData, punchData],
    members:[
      {name:'张三', ali:'13800000001', aliname:'张三', punchTime:'21:10', punchDate:'2026-08-31', orderTime:'19:50', doneTime:'20:10', orderNo:'MT20260831X001', amount:52.0},
      {name:'李四', ali:'13800000002', aliname:'李四', punchTime:'21:15', punchDate:'2026-08-31', orderTime:'19:50', doneTime:'20:10', orderNo:'MT20260831X001', amount:52.0}
    ]
  };
  let resp = await fetch(BASE+'/api/dinner/group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  let j = await resp.json();
  if(!resp.ok){ console.log('❌ 提交失败:', j); restoreDb(); process.exit(1); }
  console.log('✅ 提交成功 groupNo='+j.groupNo);

  // 2. 读取记录，验证 base64 已存库
  // 需要登录获取 token
  resp = await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'hr',password:'Zoe20260708'})});
  const lj = await resp.json();
  if(!resp.ok){ console.log('❌ 登录失败:', lj); restoreDb(); process.exit(1); }
  const token = lj.token;
  const auth = { 'Authorization':'Bearer '+token };
  resp = await fetch(BASE+'/api/dinner/records',{headers:auth});
  const recs = (await resp.json()).records;
  const rec = recs.find(r=>r.groupNo===j.groupNo);
  if(!rec){ console.log('❌ 未找到新记录'); restoreDb(); process.exit(1); }
  if(!rec.orderImgData || !rec.punchImgData){ console.log('❌ 记录未存 base64 图片!'); restoreDb(); process.exit(1); }
  console.log('✅ 记录 base64 已存库: orderImgData.length='+rec.orderImgData.length+', punchImgData.length='+rec.punchImgData.length);

  // 3. 触发识别比对（MOCK_VISION=1 返回一致数据 → 自动通过）
  resp = await fetch(BASE+'/api/dinner/records/'+rec.id+'/recognize',{method:'POST',headers:auth});
  j = await resp.json();
  console.log('识别返回:', JSON.stringify(j));
  if(!j.matched){ console.log('❌ 识别未匹配，应自动通过'); restoreDb(); process.exit(1); }
  if(j.reviewStatus!=='verified'){ console.log('❌ 应转 verified'); restoreDb(); process.exit(1); }
  console.log('✅ 识别比对一致，自动判定 '+j.status+' 可报 '+j.amount+' 元');

  // 4. 人工审核（对第二条待人工的，验证 approve 流程；MOCK 下一致已自动过，这里验证 approve 接口）
  resp = await fetch(BASE+'/api/dinner/records/'+rec.id+'/manual-review',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({action:'approve',note:'测试通过'})});
  j = await resp.json();
  if(!resp.ok){ console.log('❌ 人工审核失败:', j); restoreDb(); process.exit(1); }
  console.log('✅ 人工审核通过: '+j.status+' 可报 '+j.amount+' 元');

  // 5. 打款（JSON + receiptData）
  resp = await fetch(BASE+'/api/dinner/records/'+rec.id+'/pay',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({note:'支付宝测试', receiptData:fakeDataUrl('receipt')})});
  j = await resp.json();
  if(!resp.ok){ console.log('❌ 打款失败:', j); restoreDb(); process.exit(1); }
  console.log('✅ 打款成功 batchId='+j.paidBatchId);

  console.log('\n🎉 全部通过！方案A（base64 存库）端到端验证成功');
  restoreDb();
  process.exit(0);
}

function restoreDb(){
  try{
    if(hadDb && fs.existsSync(DB_BAK)) fs.copyFileSync(DB_BAK, DB_FILE);
    else if(!hadDb && fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
    fs.unlinkSync(DB_BAK);
    console.log('已恢复 data/db.json');
  }catch(e){}
}

main().catch(e=>{ console.error('❌ 测试异常:', e.message); restoreDb(); if(child) child.kill(); process.exit(1); });
