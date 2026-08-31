// 本地端到端测试：真实调用智谱 vision API
const fs = require('fs');
const path = require('path');
const { recognize } = require('./lib/vision');

const img = process.argv[2];
const kind = process.argv[3] || 'order';

if (!img || !fs.existsSync(img)) {
  console.error('用法: node test-vision.js <图片路径> [order|punch]');
  process.exit(1);
}

process.env.VISION_API_KEY = process.env.VISION_API_KEY || require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').find(l => l.startsWith('VISION_API_KEY=')).slice('VISION_API_KEY='.length).trim();

(async () => {
  const t0 = Date.now();
  try {
    const buf = fs.readFileSync(img);
    const r = await recognize(buf, kind);
    console.log('✅ 识别成功 (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('❌ 失败 (' + ((Date.now() - t0) / 1000).toFixed(1) + 's):', e.message);
    console.log('code =', e.code, 'status =', e.status || '-');
    if (e.partial) console.log('partial =', JSON.stringify(e.partial));
    if (e.raw) console.log('raw =', e.raw);
    process.exitCode = 1;
  }
})();
