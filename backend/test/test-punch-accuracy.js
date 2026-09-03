// 真实样本准确度测试：拿线上数据库的 3 张真实打卡截图反复跑识别
// 期望：punchTime 拿到括号内的小字时间（21:53 / 21:34 / 22:36），punchDate 拿到正确日期
const fs = require('fs');
const path = require('path');
const vision = require('../lib/vision');

const IMGS = 'C:/Users/EDY/AppData/Local/Temp/dinner-test/imgs';
const samples = [
  { file: 'Zoe_2026-08-27_punch.jpg', expectDate: '2026-08-27', expectTime: '21:53' },
  { file: 'Zoe_2026-08-28_punch.jpg', expectDate: '2026-08-28', expectTime: '21:34' },
  { file: 'Massie_2026-08-28_punch.jpg', expectDate: '2026-08-28', expectTime: '22:36' }
];

(async () => {
  const hasKey = !!process.env.VISION_API_KEY;
  if (!hasKey) {
    console.log('无 VISION_API_KEY，载入 .env');
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  console.log('VISION_API_KEY:', process.env.VISION_API_KEY ? '已设置' : '未设置');
  console.log('VISION_MODEL:', process.env.VISION_MODEL || '(default glm-4.6v-flash)');
  console.log('---');
  for (const s of samples) {
    const buf = fs.readFileSync(path.join(IMGS, s.file));
    try {
      const r = await vision.recognize(buf, 'punch');
      const okDate = r.punchDate === s.expectDate;
      const okTime = r.punchTime === s.expectTime;
      console.log(`${okDate && okTime ? '✅' : '❌'} ${s.file}`);
      console.log(`   期望: ${s.expectDate} ${s.expectTime} | 实际: ${r.punchDate} ${r.punchTime} (conf=${r.confidence})`);
      if (!okTime && r.punchTime) console.log(`   ⚠️ 错位: 取到了 ${r.punchTime}，但真实应为 ${s.expectTime}（左侧大数字是排班时间，真实打卡在小字括号里）`);
    } catch (e) {
      console.log(`❌ ${s.file}: ${e.message}`);
    }
    console.log('');
  }
})();