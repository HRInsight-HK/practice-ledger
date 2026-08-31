// 单元测试：验证 recognizeOne 的比对逻辑（纯逻辑，不依赖外部 API）
const assert = require('assert');

const CUT_A = 19*60+30, CUT_B=20*60+30;
function toMin(t){ if(!t||!/^\d{1,2}:\d{2}$/.test(t)) return null; const [h,m]=t.split(':').map(Number); return h*60+m; }

// 比对逻辑（与 routes/dinner.js recognizeOne 中一致）
function compare(fields, ai, hasOrderImg, hasPunchImg){
  const f = fields||{};
  const mismatch=[];
  let matched=true;
  const cmpTime=(filled, aiVal, label)=>{
    if(!filled&&!aiVal) return null;
    if(filled&&!aiVal){ mismatch.push(label+'：员工填写 '+filled+'，截图识别不出'); return false; }
    if(!filled&&aiVal){ mismatch.push(label+'：员工未填写，截图识别为 '+aiVal); return false; }
    const isTime=/^\d{1,2}:\d{2}$/.test(filled)&&/^\d{1,2}:\d{2}$/.test(aiVal);
    if(isTime){
      const fmin=toMin(filled), amin=toMin(aiVal);
      if(Math.abs(fmin-amin)>3){ mismatch.push(label+'：员工填写 '+filled+'，截图识别 '+aiVal); return false; }
    } else {
      if(String(filled).trim()!==String(aiVal).trim()){ mismatch.push(label+'：员工填写 '+filled+'，截图识别 '+aiVal); return false; }
    }
    return true;
  };
  if(hasPunchImg){ if(!cmpTime(f.punchTime, ai.punchTime, '打卡时间')) matched=false; if(!cmpTime(f.punchDate, ai.punchDate, '打卡日期')) matched=false; }
  if(hasOrderImg){
    if(!cmpTime(f.orderTime, ai.orderTime, '下单时间')) matched=false;
    if(f.orderNo&&ai.orderNo&&String(f.orderNo).trim()!==String(ai.orderNo).trim()){ mismatch.push('订单号：员工 '+f.orderNo+' / 识别 '+ai.orderNo); matched=false; }
    if(f.amount&&ai.amount&&Math.abs(Number(f.amount)-Number(ai.amount))>0.5){ mismatch.push('金额：员工 '+f.amount+' / 识别 '+ai.amount); matched=false; }
  }
  return { matched, mismatch };
}

const cases = [
  { name:'一致：员工填19:42/21:10，识别同 → matched',
    fields:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    ai:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    img:true, expect:true },
  { name:'不一致：员工填18:00，识别19:42（差>3分钟）→ not matched',
    fields:{orderTime:'18:00',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    ai:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    img:true, expect:false },
  { name:'允许误差：员工填19:41，识别19:42（差1分钟）→ matched',
    fields:{orderTime:'19:41',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    ai:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    img:true, expect:true },
  { name:'打卡时间员工未填但识别有值 → not matched',
    fields:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'',punchDate:'2026-08-28'},
    ai:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    img:true, expect:false },
  { name:'订单号不一致 → not matched',
    fields:{orderTime:'19:42',orderNo:'MT102',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    ai:{orderTime:'19:42',orderNo:'MT999',amount:46.5,punchTime:'21:10',punchDate:'2026-08-28'},
    img:true, expect:false },
];

let pass=0, fail=0;
for(const c of cases){
  const {matched, mismatch} = compare(c.fields, c.ai, c.img, c.img);
  const ok = matched===c.expect;
  console.log((ok?'✅':'❌')+' '+c.name + (ok?'':'\n    mismatches: '+mismatch.join('；')));
  ok?pass++:fail++;
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
