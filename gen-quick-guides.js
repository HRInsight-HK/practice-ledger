const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');
const path = require('path');

const CLOUD_URL = 'https://practice-ledger.onrender.com';
const Q_URL = CLOUD_URL + '/questionnaire';
const FONT = 'Microsoft YaHei';
const BLUE = '1a56c4', DARK = '1a1a2e', GRAY = '666666', RED = 'dc2626';
const LIGHT_BG = 'f0f4ff', DANGER_BG = 'fce4ec', GREEN_BG = 'd1fae5', GREEN_TEXT = '065f46';

function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, bold: true, size: 26, color: BLUE, font: FONT })] }); }
function p(t, o = {}) { return new Paragraph({ spacing: { before: 50, after: 50 }, alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: t, size: 21, font: FONT, ...o })] }); }
function step(n, t) { return new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: n + '  ', bold: true, size: 21, color: BLUE, font: FONT }), new TextRun({ text: t, size: 21, font: FONT })] }); }
function bullet(t) { return new Paragraph({ spacing: { before: 30, after: 30 }, bullet: { level: 0 }, children: [new TextRun({ text: t, size: 21, font: FONT })] }); }
function emptyLine() { return new Paragraph({ spacing: { before: 60, after: 60 }, children: [] }); }
function tipBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: LIGHT_BG }, margins: { top: 70, bottom: 70, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: BLUE })] })] })] })] });
}
function warnBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: DANGER_BG }, margins: { top: 70, bottom: 70, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: RED, bold: true })] })] })] })] });
}
function okBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: GREEN_BG }, margins: { top: 70, bottom: 70, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: GREEN_TEXT, bold: true })] })] })] })] });
}
function thCell(t, w) { return new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: BLUE }, margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: true, size: 20, color: 'FFFFFF', font: FONT })] })] }); }
function tdCell(t, o = {}) { return new TableCell({ margins: { top: 45, bottom: 45, left: 80, right: 80 }, children: [new Paragraph({ alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: String(t), size: 20, font: FONT, bold: o.bold, color: o.color || DARK })] })] }); }
function makeTable(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(100 / headers.length));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ children: headers.map((h, i) => thCell(h, w[i])) }),
    ...rows.map(row => new TableRow({ children: row.map((c, ci) => tdCell(typeof c === 'object' ? c.text : c, typeof c === 'object' ? c : {})) }))
  ] });
}
function makeDoc(children, headerText) {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { before: 50, after: 50 } } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: headerText, size: 16, color: GRAY, font: FONT })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '第 ', size: 16, color: GRAY, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: FONT }), new TextRun({ text: ' 页', size: 16, color: GRAY, font: FONT })] })] }) },
      children
    }]
  });
}
function title(main, person) {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: main, bold: true, size: 36, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 30 }, children: [new TextRun({ text: '快速上手手册（精简版）  |  ' + person + '  |  2026年8月', size: 20, color: GRAY, font: FONT })] }),
    emptyLine()
  ];
}

// ==================== 1. 行政 ====================
function docAdmin() {
  return makeDoc([
    ...title('行政快速上手手册', '适用：莫青霖（admin）'),

    h2('你的职责一句话'),
    p('把每一份实操需求登记成台账：人员信息 + 联系方式 + 设备台账，登记完系统自动通知SSC接手。'),
    emptyLine(),

    h2('登录'),
    makeTable(['地址', '账号', '密码'], [[CLOUD_URL, 'admin', 'Zz741852']], [50, 20, 30]),
    emptyLine(),

    h2('日常操作（就3步）'),
    step('①', '登录后点击"问卷需求"，查看待处理问卷（系统收到问卷时企微群会@全员提醒你）'),
    step('②', '点击"导入登记"，系统自动带入问卷信息，你补充：'),
    bullet('一级部门（必填）、二级部门（选填）'),
    bullet('联系方式：电话 / 企业微信 / 私人微信'),
    bullet('设备台账：点"+ 添加设备"逐行登记，每行填 花名、设备型号、品牌、序列号、企业微信账号、私人微信账号、其他账号登记（多台设备每台一行）'),
    step('③', '点"确认登记"完成。系统自动企微通知，SSC会接着上传简历、录薪资'),
    emptyLine(),

    h2('登记后你要盯的事'),
    makeTable(['看什么', '哪里看'], [
      ['实操中人员状态、剩余天数', '首页列表（绿色=实操中）'],
      ['天数>7天预警', '企微群自动@HRD+@全员，你不用处理，但要提醒需求方下次控制天数'],
    ], [50, 50]),
    emptyLine(),

    h2('常见问题'),
    bullet('填错了：列表里点"编辑"随时改'),
    bullet('重复/无效问卷：点"忽略"'),
    bullet('设备序列号务必准确，离场交接全靠它'),
    emptyLine(),
  ], '行政快速上手手册 v3.3');
}

// ==================== 2. SSC ====================
function docSSC() {
  return makeDoc([
    ...title('SSC快速上手手册', '适用：Zoe（hr）'),

    h2('你的职责一句话'),
    p('上传简历归档、本地录薪资、到期跟进反馈、办入职或结算——实操人员的"后半程"全归你。'),
    emptyLine(),

    h2('云端后台'),
    makeTable(['地址', '账号', '密码'], [[CLOUD_URL, 'hr', 'Zoe20260708']], [50, 20, 30]),
    h2('本地薪资工具（不上云）'),
    makeTable(['地址', '启动方式'], [['http://localhost:8080/hr-local.html', '命令行执行：cd E:\\实操台账 → python -m http.server 8080']], [45, 55]),
    emptyLine(),

    h2('日常操作'),
    step('①', '行政登记后（企微会通知），收到实操人员简历就上传：列表点"📎简历"→ 选文件 → 上传（支持PDF/Word/图片，≤2MB，云端永久保存，可下载/替换/删除）'),
    step('②', '本地工具录薪资：登录后点"🔄同步云端数据"拉取人员 → 点"登记薪资"填写 → 定期点"导出数据"备份'),
    step('③', '到期跟进：T-3/T-1企微自动@你，T-0提醒带教人填反馈；你也可在后台点"填写反馈"代录（结果+出勤+意见+凭证照片）'),
    step('④', '反馈通过 → 后台点"办理入职"填入职日期；反馈不通过 → 本地工具"办结算"确认金额 + 后台点"办理结算"更新状态'),
    emptyLine(),

    h2('时间节点（系统自动@你，不用自己记）'),
    makeTable(['节点', '你要做什么'], [
      ['行政登记后', '传简历 + 本地录薪资'],
      ['T-3（结束前3天）', '开始联系带教人要反馈'],
      ['T-1（结束前1天）', '催反馈，务必当天有结果'],
      ['T-0（到期当天）', '记录反馈结果'],
      ['T+3（逾期3天）', '系统@全员预警，立即介入'],
      ['反馈提交后', '办入职 或 办结算'],
    ], [35, 65]),
    emptyLine(),

    warnBox('两条红线：1. 薪资数据只在本地，绝不上传云端，每周导出备份一次；2. 实操>7天必须HRD审批，你提前核算薪资准备结算。'),
  ], 'SSC快速上手手册 v3.3');
}

// ==================== 3. 组长/需求方 ====================
function docRequester() {
  return makeDoc([
    ...title('组长/需求方快速上手手册', '适用：组长、管理层（需求方）'),

    h2('你的职责一句话'),
    p('要安排实操人员？提前3天填个问卷就行，剩下的事系统自动流转。'),
    emptyLine(),

    h2('唯一入口（免登录）'),
    tipBox(Q_URL + '   （建议收藏，或转发给需要提交需求的同事）'),
    emptyLine(),

    h2('怎么填'),
    bullet('提交人姓名、你的身份（管理层/组长）'),
    bullet('实操人员姓名、建议带教人'),
    bullet('一级部门（必填）、二级部门（选填）、业务方向'),
    bullet('期望开始日期、预计实操天数（建议不超过7天）'),
    bullet('设备需求、备注'),
    emptyLine(),
    p('提交后：企微群自动@全员 → 行政1个工作日内完成登记 → SSC接手录入。'),
    emptyLine(),

    h2('实操结束前你要做的'),
    step('①', '到期当天企微会收到带链接的提醒（组长 + @SSC）'),
    step('②', '点开反馈表单，填：实操结果（通过/不通过）、出勤记录、反馈意见，可传纸质反馈表照片'),
    step('③', '提交后系统自动@HRD+@全员，SSC接着办入职或结算'),
    emptyLine(),

    h2('三条记住就够'),
    warnBox('1. 提前≥3天提交！当天报当天用，行政和SSC来不及准备。'),
    bullet('实操天数尽量≤7天，超了系统自动发用工风险预警@HRD+@全员'),
    bullet('问卷提交后改不了，要改联系行政（莫青霖）；紧急需求直接企微找行政或SSC（Zoe）'),
    emptyLine(),
    okBox('全流程你只有两个动作：填问卷、填反馈。其余系统+行政+SSC搞定。'),
  ], '组长需求方快速上手手册 v3.3');
}

// ==================== 4. HRD/管理层 ====================
function docManager() {
  return makeDoc([
    ...title('HRD/管理层快速上手手册', '适用：massie（manager）'),

    h2('你的职责一句话'),
    p('看全局数据、管风险审批、批入职——系统自动把该你管的事@到你面前。'),
    emptyLine(),

    h2('登录（只读全量数据）'),
    makeTable(['地址', '账号', '密码'], [[CLOUD_URL, 'manager', '4302055540j']], [50, 20, 30]),
    emptyLine(),

    h2('你会收到哪些自动通知'),
    makeTable(['事件', '@对象', '你要做什么'], [
      ['实操天数>7天预警', '@HRD+@全员', '评估用工风险，决定是否批准继续（须签知情同意书）'],
      ['反馈结果提交', '@HRD+@全员', '知悉通过/不通过结果'],
      ['实操通过待入职', '@HRD+@SSC', '审批正式入职'],
      ['逾期3天未反馈', '@全员', '必要时直接介入处理'],
    ], [30, 25, 45]),
    emptyLine(),

    h2('登录后台能看什么'),
    bullet('全量实操人员台账：状态、剩余天数、带教人、反馈结果'),
    bullet('人员简历下载（SSC归档的简历随时调取）'),
    bullet('设备台账：每人的设备型号、序列号、账号绑定'),
    bullet('账号管理：可创建/管理各角色账号'),
    emptyLine(),

    h2('你的三个决策点'),
    step('①', '实操要超7天：批不批？批了要签知情同意书（规避事实劳动关系风险）'),
    step('②', '反馈不通过：确认结算金额（SSC在本地工具操作）'),
    step('③', '反馈通过：批入职，SSC办理入职手续'),
    emptyLine(),

    h2('风险机制（系统已内置）'),
    bullet('实操不签劳动合同，以"实操评估"名义，结束当天必须有结论（入职或结算离场）'),
    bullet('逾期未反馈自动升级@全员 + 劳动风险提示'),
    bullet('薪资数据物理隔离在SSC本地，绝不上云，你看不到也无需看'),
    emptyLine(),
    okBox('总结：不用记流程，企微@到你就处理，登录后台随时看全局。'),
  ], 'HRD管理层快速上手手册 v3.3');
}

// ==================== 5. 总手册（总览版） ====================
function docMaster() {
  return makeDoc([
    ...title('实操台账系统总手册', '总览版  |  适用：全体角色'),

    h2('一、系统是什么'),
    p('一套管理实操人员全流程的云端系统：需求提交 → 行政登记 → SSC录入 → 到期跟进 → 反馈 → 入职/结算，每个节点由企微机器人自动提醒，无需人工催办。'),
    tipBox('管理后台：' + CLOUD_URL + '    问卷表单（免登录）：' + Q_URL),
    emptyLine(),

    h2('二、四个角色一览'),
    makeTable(['角色', '人员', '账号', '职责一句话'], [
      ['组长/需求方', '各组长、管理层', '免登录', '提前≥3天填问卷，到期填反馈'],
      ['行政', '莫青霖', 'admin', '登记人员+联系方式+设备台账'],
      ['SSC', 'Zoe', 'hr', '传简历、本地录薪资、跟进反馈、办入职/结算'],
      ['HRD/管理层', 'massie', 'manager', '看全局、管>7天审批、批入职'],
    ], [20, 20, 15, 45]),
    emptyLine(),

    h2('三、全流程（5个阶段）'),
    makeTable(['阶段', '谁做', '做什么', '企微通知'], [
      ['1. 需求提交', '组长/管理层', '提前≥3天填问卷（姓名/带教人/部门/日期/天数）', '@全员'],
      ['2. 行政登记', '行政(莫青霖)', '导入问卷，补：一级/二级部门、联系方式（电话/企微/微信）、设备台账（花名/型号/品牌/序列号/企微账号/微信/其他账号，每台设备一行）', '@青霖'],
      ['3. SSC录入', 'SSC(Zoe)', '上传简历（📎按钮，≤2MB）+ 本地工具录薪资', '—'],
      ['4. 到期跟进', '系统+SSC', 'T-3/T-1自动@SSC，T-0提醒带教人填反馈（通过/不通过+出勤+意见+凭证）', 'T-3/T-1@SSC，T-0组长+@SSC'],
      ['5. 入职/结算', 'SSC+HRD', '通过→办入职；不通过→本地结算+后台更新状态', '@HRD+@SSC / @HRD+@全员'],
    ], [13, 15, 50, 22]),
    emptyLine(),

    h2('四、自动通知规则'),
    makeTable(['事件', '@对象'], [
      ['问卷提交 / 逾期3天', '@全员'],
      ['行政登记', '@青霖'],
      ['实操天数>7天预警', '@HRD + @全员'],
      ['结束前3天(T-3) / 前1天(T-1)', '@SSC'],
      ['到期当天(T-0)', '组长 + @SSC'],
      ['反馈结果提交', '@HRD + @全员'],
      ['办理入职', '@HRD + @SSC'],
    ], [55, 45]),
    emptyLine(),

    h2('五、三条红线'),
    step('①', '实操天数≤7天：超过自动发用工风险预警@HRD+@全员，继续须HRD审批并签知情同意书'),
    step('②', '需求提前≥3天提交：当天报当天用，行政和SSC来不及准备'),
    step('③', '薪资不上云：薪资只在SSC本地加密工具，云端系统不含薪资字段'),
    emptyLine(),

    h2('六、数据存放'),
    makeTable(['数据', '存放位置'], [
      ['人员信息 / 联系方式 / 设备台账 / 简历 / 反馈', '云端系统（' + CLOUD_URL + '）'],
      ['薪资结构 / 金额', 'SSC本地加密工具，绝不上云'],
      ['提醒通知', '企微群机器人，只转发不存数据'],
    ], [50, 50]),
    emptyLine(),
    okBox('各角色的详细操作步骤见对应的《快速上手》分册；完整规则见《系统操作指南(完整版)》。'),
  ], '实操台账系统总手册 v3.3');
}

// ==================== Generate ====================
(async () => {
  const outDir = path.join('E:', '实操台账', 'docs', '快速上手手册');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const docs = [
    { fn: docMaster, name: '快速上手_总手册.docx' },
    { fn: docAdmin, name: '快速上手_行政(莫青霖).docx' },
    { fn: docSSC, name: '快速上手_SSC(Zoe).docx' },
    { fn: docRequester, name: '快速上手_组长需求方.docx' },
    { fn: docManager, name: '快速上手_HRD管理层(massie).docx' },
  ];
  for (const d of docs) {
    const buf = await Packer.toBuffer(d.fn());
    fs.writeFileSync(path.join(outDir, d.name), buf);
    console.log('Generated:', d.name, '-', buf.length, 'bytes');
  }
  console.log('Done. Directory:', outDir);
})().catch(e => { console.error(e); process.exit(1); });
