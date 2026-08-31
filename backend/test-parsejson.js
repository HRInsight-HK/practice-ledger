// 单元测试：vision.js parseJsonSafe 容错性
const { parseJsonSafe } = require('./lib/vision');

const cases = [
  // 1. 标准 JSON（应通过）
  { name: '标准 JSON', input: '{"orderTime":"19:42","amount":46.5}', expect: { orderTime: '19:42', amount: 46.5 } },
  // 2. 带 markdown 围栏
  { name: '带 markdown 围栏', input: '```json\n{"orderTime":"19:42","amount":46.5}\n```', expect: { orderTime: '19:42', amount: 46.5 } },
  // 3. 围栏无语言标识
  { name: '围栏无语言', input: '```\n{"orderTime":"19:42"}\n```', expect: { orderTime: '19:42' } },
  // 4. 前缀说明文字 + JSON（智谱限速常见输出）
  { name: '前缀说明+JSON', input: '好的，以下是识别结果：\n{"orderTime":"19:42","amount":46.5,"confidence":95}', expect: { orderTime: '19:42', amount: 46.5, confidence: 95 } },
  // 5. 英文前缀
  { name: '英文前缀 Here is', input: 'Here is the JSON result:\n{"punchTime":"21:10","punchDate":"2026-08-28"}', expect: { punchTime: '21:10', punchDate: '2026-08-28' } },
  // 6. JSON 后面跟着说明
  { name: 'JSON 后跟说明', input: '{"orderTime":"19:42"}\n根据图片信息，这是订单时间', expect: { orderTime: '19:42' } },
  // 7. 多余空格
  { name: '多余空格', input: '   {"orderTime":"19:42"}   ', expect: { orderTime: '19:42' } },
  // 8. 换行 + JSON
  { name: '换行+JSON', input: '\n\n{"orderTime":"19:42","amount":46.5}\n\n', expect: { orderTime: '19:42', amount: 46.5 } },
  // 9. 纯文字（应失败 → null）
  { name: '纯文字（应失败）', input: '抱歉，无法识别该图片内容', expect: null },
  // 10. 空字符串
  { name: '空字符串', input: '', expect: null },
  // 11. null
  { name: 'null', input: null, expect: null },
  // 12. 智谱返回字符串字面量（极少见）
  { name: '空对象', input: '{}', expect: {} },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = parseJsonSafe(c.input);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (ok) {
    pass++;
    console.log('  ✅', c.name);
  } else {
    fail++;
    console.log('  ❌', c.name);
    console.log('     期望:', JSON.stringify(c.expect));
    console.log('     实际:', JSON.stringify(got));
  }
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);