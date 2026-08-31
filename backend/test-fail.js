// E2E：模拟智谱完全宕机，确认错误信息清晰且能传 raw 内容
process.env.MOCK_VISION = '1';  // 暂存
delete process.env.MOCK_VISION;
global.fetch = async function() {
  return new Response('{"choices":[{"message":{"content":"抱歉，服务器繁忙，请稍后再试"}}]}', { status: 200, headers: { 'content-type': 'application/json' } });
};
process.env.VISION_API_KEY = 'fake';

const v = require('./lib/vision');
const img = Buffer.from('89504e470d0a1a0a', 'hex');
v.recognize(img, 'order')
  .then(r => console.log('意外成功:', JSON.stringify(r)))
  .catch(e => {
    console.log('✅ 错误类型:', e.code);
    console.log('✅ 错误信息:', e.message.slice(0, 150));
    console.log('✅ raw 前100字符:', String(e.raw || '').slice(0, 100));
    const ok = e.code === 'VISION_PARSE_FAIL' && e.message.includes('不是有效 JSON') && e.raw && e.raw.includes('服务器繁忙');
    console.log(ok ? '\n✅ 完整错误链 OK' : '\n❌ 错误信息不达预期');
    process.exit(ok ? 0 : 1);
  });