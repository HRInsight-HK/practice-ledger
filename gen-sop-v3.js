const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType,
  Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');
const path = require('path');

const CLOUD_URL = 'https://practice-ledger.onrender.com';
const Q_URL = CLOUD_URL + '/questionnaire';
const FONT = 'Microsoft YaHei';
const BLUE = '1a56c4', DARK = '1a1a2e', GRAY = '666666', RED = 'dc2626', ORANGE = 'ea580c';
const LIGHT_BG = 'f0f4ff', DANGER_BG = 'fce4ec';

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, size: 32, color: BLUE, font: FONT })] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, bold: true, size: 26, color: BLUE, font: FONT })] }); }
function h3(t) { return new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, bold: true, size: 22, color: DARK, font: FONT })] }); }
function p(t, o = {}) { return new Paragraph({ spacing: { before: 60, after: 60 }, alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: t, size: 21, font: FONT, ...o })] }); }
function bullet(t, l = 0) { return new Paragraph({ spacing: { before: 40, after: 40 }, bullet: { level: l }, children: [new TextRun({ text: t, size: 21, font: FONT })] }); }
function emptyLine() { return new Paragraph({ spacing: { before: 80, after: 80 }, children: [] }); }

function warningBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: DANGER_BG }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: RED, bold: true })] })] })] })] });
}
function tipBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: LIGHT_BG }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: BLUE })] })] })] })] });
}
const GREEN_BG = 'd1fae5', GREEN_TEXT = '065f46';
function statusBadge() {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: GREEN_BG }, margins: { top: 60, bottom: 60, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: '✅ 该系统已投入运行  |  云端地址：' + CLOUD_URL, size: 20, font: FONT, color: GREEN_TEXT, bold: true })] })] })] })] });
}
function authorLine() {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 60 }, children: [new TextRun({ text: '整理：Zoe（SSC）', size: 18, color: GRAY, font: FONT, italics: true })] });
}

function thCell(t, w) {
  return new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: BLUE }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: true, size: 20, color: 'FFFFFF', font: FONT })] })] });
}
function tdCell(t, o = {}) {
  return new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined, children: [new Paragraph({ alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: String(t), size: 20, font: FONT, bold: o.bold, color: o.color || DARK })] })] });
}
function makeTable(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(100 / headers.length));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ children: headers.map((h, i) => thCell(h, w[i])) }),
    ...rows.map((row, ri) => new TableRow({ children: row.map((cell, ci) => {
      const o = typeof cell === 'object' ? cell : { text: cell };
      return tdCell(o.text || cell, { ...o, fill: ri % 2 === 1 ? 'f5f7fa' : (o.fill || undefined) });
    }) }))
  ] });
}

function makeDoc(children, headerText) {
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { before: 60, after: 60 } } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      headers: headerText ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: headerText, size: 16, color: GRAY, font: FONT })] })] }) } : undefined,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '第 ', size: 16, color: GRAY, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: FONT }), new TextRun({ text: ' 页', size: 16, color: GRAY, font: FONT })] })] }) },
      children
    }]
  });
}

const NOTIFICATIONS = [
  ['问卷提交', '新实操需求已提交，请行政尽快登记', '@全员'],
  ['行政登记', '新实操人员已登记，请SSC填写薪资', '@青霖'],
  ['天数>7天', '实操天数超过7天，存在用工风险，请HRD关注，SSC提前核算薪资并准备反馈结果收集', '@HRD + @全员'],
  ['结束前3天(T-3)', 'XX实操还有3天结束，请跟进反馈', '@SSC'],
  ['结束前1天(T-1)', 'XX实操还剩1天，请务必完成反馈记录', '@SSC'],
  ['到期当天(T-0)', 'XX实操今天到期，请填写反馈', '组长 + @SSC'],
  ['逾期3天(T+3)', '已逾期3天，需管理层关注，存在劳动风险', '@全员'],
  ['反馈提交', '反馈结果已提交（通过/不通过）', '@HRD + @全员'],
  ['办理入职', 'XX已通过实操，请办理正式入职', '@HRD + @SSC'],
];

// ==================== Document 1: 简版SOP ====================
function createSOP() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: '实操人员全流程管理SOP', bold: true, size: 40, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: 'Version 3.2  |  2026年7月', size: 20, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h1('一、角色与人员'),
    p('本系统涉及4个角色，各角色对应人员及系统账号如下：'),
    emptyLine(),
    makeTable(['角色', '人员', '系统账号', '密码', '核心职责'],
      [
        [{text:'需求方',bold:true}, '组长 / 管理层', '-', '-', '发起实操需求，填写问卷表单，须提前>=3天'],
        [{text:'行政',bold:true}, '莫青霖', 'admin', 'admin123', '处理问卷、登记人员信息、录入设备、跟踪状态'],
        [{text:'SSC',bold:true}, 'Zoe', 'hr', 'hr666', '录入薪资（本地不上云）、跟进反馈、办理入职/结算、账号管理'],
        [{text:'HRD',bold:true}, 'massie', 'manager', 'mgr888', '审批正式入职、查看全量数据、关注风险预警、账号管理'],
      ], [12, 15, 12, 12, 49]),
    emptyLine(),

    h1('二、系统入口'),
    makeTable(['入口', '地址', '说明'],
      [
        ['问卷表单', Q_URL, '免登录，需求方填写'],
        ['管理后台', CLOUD_URL, '行政/SSC/HRD登录'],
        ['反馈表单', CLOUD_URL + '/feedback/:token', '带教人免登录填写'],
        ['本地SSC工具', 'http://localhost:8080/hr-local.html', '薪资管理，不上云（需先启动本地服务器）'],
      ], [15, 45, 40]),
    emptyLine(),

    h1('三、流程总览'),
    p('实操人员从需求提交到入职/离场，共5个阶段，全流程通过企微群机器人自动驱动：'),
    emptyLine(),
    makeTable(['阶段', '动作', '负责人', '企微通知', '时间节点'],
      [
        [{text:'1. 需求提交',bold:true}, '填写问卷表单', '需求方(组长/管理层)', '@全员', '入职前>=3天'],
        [{text:'2. 行政登记',bold:true}, '导入问卷->补充设备', '行政(莫青霖)', '@青霖', '实操首日'],
        [{text:'3. SSC录入',bold:true}, '填写薪资（本地工具）', 'SSC(Zoe)', '-', '实操首日'],
        [{text:'4. 到期跟进',bold:true}, '跟进反馈->记录结果+凭证', 'SSC(Zoe)/带教人', '@SSC(T-3/T-1)', '结束前3天起'],
        [{text:'5. 入职/结算',bold:true}, '通过->入职 / 不通过->结算', 'SSC(Zoe)', '@HRD+@SSC', '反馈当天'],
      ], [15, 30, 18, 17, 20]),
    emptyLine(),

    h1('四、关键规则'),
    h3('4.1 实操天数限制'),
    p('实操天数建议不超过7天。超过7天存在用工风险（事实劳动关系、劳动仲裁等），系统会在登记时自动预警并通知企微群。'),
    warningBox('红线：实操天数 > 7天 -> 系统自动发送用工风险预警到企微群@HRD + @全员，提醒SSC提前核算薪资并准备反馈结果收集'),
    emptyLine(),
    h3('4.2 提前同步要求'),
    p('需求方须在实操人员入职前至少提前3天提交问卷或直接报给行政，确保行政有足够时间准备设备、SSC有足够时间录入薪资。'),
    emptyLine(),
    h3('4.3 薪资保密原则'),
    p('薪资信息属于保密数据，绝不上云。薪资通过本地SSC工具管理，数据加密存储在SSC个人电脑，云端系统不含任何薪资字段。'),
    emptyLine(),

    h1('五、企微群机器人通知规则'),
    p('以下所有通知由系统自动推送，无需人工干预。@对象用职位名称（SSC/HRD），行政例外用@青霖：'),
    emptyLine(),
    makeTable(['触发事件', '通知内容', '@对象'],
      NOTIFICATIONS.map(n => [{text:n[0],bold:true}, n[1], n[2]]), [20, 55, 25]),
    emptyLine(),

    h1('六、角色职责'),
    makeTable(['角色', '核心职责', '系统权限'],
      [
        [{text:'需求方(组长/管理层)',bold:true}, '提交实操需求问卷', '免登录填写问卷'],
        [{text:'行政(莫青霖)',bold:true}, '处理问卷->登记设备->跟踪状态', '登记/编辑/查看（无薪资）'],
        [{text:'SSC(Zoe)',bold:true}, '录入薪资->跟进反馈->办理入职/结算->账号管理', '全量读写（薪资在本地）'],
        [{text:'带教人',bold:true}, '填写实操反馈表单（免登录）', '仅反馈表单'],
        [{text:'HRD(massie)',bold:true}, '查看全量数据->审批->账号管理', '只读全量'],
      ], [18, 47, 35]),
    emptyLine(),

    h1('七、异常处理'),
    makeTable(['异常场景', '处理方式', '责任人'],
      [
        ['实操天数需超过7天', '须HRD审批，签署知情同意书', 'HRD(massie)+SSC(Zoe)'],
        ['到期未收到反馈', 'T+3自动@全员预警，SSC介入联系带教人', 'SSC(Zoe)'],
        ['反馈不通过', 'SSC办理薪资结算（金额在本地工具），人员离场', 'SSC(Zoe)'],
        ['反馈通过但未入职', '持续@HRD和@SSC提醒，直到入职完成', '系统自动'],
        ['纸质反馈表', 'SSC拍照上传到系统作为凭证附件', 'SSC(Zoe)'],
      ], [25, 50, 25]),
    emptyLine(),

    h1('八、劳动风险防控'),
    bullet('实操天数严格控制在7天以内，超过需HRD审批'),
    bullet('实操期间不签订劳动合同，以"实操评估"名义进行'),
    bullet('实操结束当天必须有明确结论：通过->入职 或 不通过->结算离场'),
    bullet('逾期未反馈的，T+3自动升级到全员+劳动风险预警'),
    bullet('薪资数据绝不上云，物理隔离，防止数据泄露'),
    bullet('所有操作留痕，系统记录操作人、时间、来源'),
    emptyLine(),
    tipBox('系统已部署到云端：' + CLOUD_URL + ' 。问卷表单地址：' + Q_URL + ' 。'),
  ], '实操人员管理SOP v3.2');
}

// ==================== Document 2: 领导决策摘要 ====================
function createLeadershipGuide() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 300, after: 80 }, children: [new TextRun({ text: '实操台账系统', bold: true, size: 44, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: '领导决策摘要', size: 24, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h2('核心价值'),
    p('一套系统解决实操人员从需求到入职的全流程管理，自动驱动各角色按时完成操作，杜绝信息不同步、反馈遗漏、用工风险。'),
    emptyLine(),

    h2('角色与人员'),
    makeTable(['角色', '人员', '系统账号', '核心职责'],
      [
        ['行政', '莫青霖', 'admin', '登记人员、录入设备'],
        ['SSC', 'Zoe', 'hr', '薪资录入、跟进反馈、办理入职/结算'],
        ['HRD', 'massie', 'manager', '审批入职、关注风险、账号管理'],
      ], [15, 15, 15, 55]),
    emptyLine(),

    h2('系统地址'),
    makeTable(['入口', '地址'],
      [
        ['管理后台', CLOUD_URL],
        ['问卷表单', Q_URL],
        ['本地SSC工具', 'http://localhost:8080/hr-local.html（需先启动本地服务器）'],
      ], [25, 75]),
    emptyLine(),

    h2('流程一览'),
    p('问卷提交(@全员) -> 行政登记(@青霖) -> SSC录薪 -> 到期跟进(@SSC) -> 反馈结果(@HRD+@全员) -> 入职/结算(@HRD+@SSC)', { bold: true, color: BLUE }),
    p('全流程由企微群机器人自动驱动，无需人工催办。'),
    emptyLine(),

    h2('通知规则'),
    makeTable(['触发事件', '@对象'], NOTIFICATIONS.map(n => [{text:n[0],bold:true}, n[2]]), [50, 50]),
    emptyLine(),

    h2('关键指标'),
    makeTable(['指标', '规则', '原因'],
      [
        [{text:'实操天数上限',bold:true,color:RED}, '7天', '超过7天产生事实劳动关系风险'],
        [{text:'提前提交',bold:true}, '>=3天', '需求方须提前3天报给行政或自行填写问卷'],
        [{text:'跟进提醒',bold:true,color:ORANGE}, 'T-3 @SSC / T-1 @SSC', '确保反馈不遗漏'],
        [{text:'到期当天',bold:true}, '组长 + @SSC', '确保带教人当天填写反馈'],
        [{text:'结果通知',bold:true}, '@HRD + @全员', '确保管理层知晓结果'],
        [{text:'入职通知',bold:true}, '@HRD + @SSC', '确保入职流程不遗漏'],
      ], [25, 35, 40]),
    emptyLine(),

    h2('数据安全'),
    makeTable(['层级', '存储内容', '位置'],
      [
        [{text:'云端系统',bold:true}, '姓名/带教/日期/设备/反馈/状态', CLOUD_URL],
        [{text:'企微机器人',bold:true}, '只发提醒，不存数据', '企微群'],
        [{text:'本地SSC工具',bold:true,color:RED}, '薪资结构/金额', 'SSC(Zoe)个人电脑（加密）'],
      ], [25, 45, 30]),
    p('薪资数据物理隔离，绝不上云。', { color: RED, bold: true }),
    emptyLine(),

    h2('角色权限'),
    makeTable(['角色', '人员', '权限', '关注点'],
      [
        ['行政', '莫青霖', '登记/编辑', '设备信息、实操周期'],
        ['SSC', 'Zoe', '全量读写', '薪资、反馈、入职/结算'],
        ['HRD', 'massie', '只读全量', '统计数据、风险预警'],
      ], [15, 15, 20, 50]),
    emptyLine(),

    h2('管理层决策点'),
    bullet('实操天数 > 7天时，是否批准？须签署知情同意书'),
    bullet('反馈不通过时，确认薪资结算金额（SSC在本地工具操作）'),
    bullet('逾期3天未反馈时，是否需要直接介入处理'),
    emptyLine(),

    h2('系统账号'),
    makeTable(['角色', '用户名', '密码', '人员'],
      [
        ['行政', 'admin', 'admin123', '莫青霖'],
        ['SSC', 'hr', 'hr666', 'Zoe'],
        ['HRD', 'manager', 'mgr888', 'massie'],
      ], [25, 25, 25, 25]),
    emptyLine(),
    tipBox('系统已部署上线：' + CLOUD_URL),
  ], '领导决策摘要 v3.2');
}

// ==================== Document 3: 需求方操作SOP ====================
function createRequesterSOP() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: '需求方操作SOP', bold: true, size: 36, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: 'Version 3.2  |  2026年7月', size: 20, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h2('一、适用对象'),
    p('组长、管理层（需求方），即需要安排实操人员的人员。'),
    emptyLine(),

    h2('二、系统入口'),
    makeTable(['入口', '地址', '说明'], [['问卷表单', Q_URL, '免登录，直接填写']], [20, 55, 25]),
    emptyLine(),
    tipBox('请将此链接收藏或发送给需要提交需求的同事：' + Q_URL),
    emptyLine(),

    h2('三、操作步骤'),
    h3('步骤1：填写问卷表单'),
    p('打开问卷表单地址：' + Q_URL),
    p('填写以下信息：'),
    bullet('提交人姓名（您的姓名）'),
    bullet('您的身份（管理层 / 组长 / 员工）'),
    bullet('实操人员姓名（需要安排实操的人员全名）'),
    bullet('建议带教人（直接带教负责人）'),
    bullet('一级部门（必填，如：市场部、运营部）'),
    bullet('二级部门（选填，如：门店运营组）'),
    bullet('业务方向（如：门店运营）'),
    bullet('期望开始日期'),
    bullet('预计实操天数（建议不超过7天）'),
    bullet('设备需求（如需配发设备）'),
    bullet('备注（其他说明）'),
    emptyLine(),

    h3('步骤2：提交后等待'),
    p('提交后，系统会自动在企微群发送通知@全员，行政（莫青霖）会在1个工作日内完成登记。'),
    p('行政登记后，SSC（Zoe）会录入薪资信息并开始跟进。'),
    emptyLine(),

    h3('步骤3：实操期间'),
    p('实操即将结束时（结束前3天、1天），系统会自动提醒SSC（Zoe）跟进反馈。'),
    p('到期当天，您（带教人）会收到通知，请及时填写反馈表单。'),
    emptyLine(),

    h3('步骤4：反馈填写'),
    p('到期当天，您会收到一条带反馈链接的企微通知。'),
    p('点击链接打开反馈表单，填写：'),
    bullet('实操结果（通过 / 不通过）'),
    bullet('出勤记录（出勤天数、迟到次数、早退次数）'),
    bullet('反馈意见'),
    bullet('上传凭证（纸质反馈表照片等，可选）'),
    emptyLine(),
    p('提交后，系统自动通知@HRD（massie）+ @全员。'),
    emptyLine(),

    h2('四、注意事项'),
    warningBox('务必提前>=3天提交需求！否则行政和SSC可能来不及准备设备和薪资。'),
    bullet('实操天数建议不超过7天，超过7天系统会自动发送用工风险预警'),
    bullet('问卷提交后无法自行修改，如需更改请联系行政（莫青霖）'),
    bullet('如有紧急需求，直接联系行政（莫青霖）或SSC（Zoe）'),
    emptyLine(),
    tipBox('紧急联系方式：行政 莫青霖 / SSC Zoe（通过企微群联系）'),
  ], '需求方操作SOP v3.2');
}

// ==================== Document 4: 行政操作SOP ====================
function createAdminSOP() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: '行政操作SOP', bold: true, size: 36, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: 'Version 3.2  |  2026年7月', size: 20, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h2('一、适用对象'),
    p('行政人员（莫青霖），负责实操人员的登记和设备管理。'),
    emptyLine(),

    h2('二、系统入口'),
    makeTable(['入口', '地址', '说明'],
      [
        ['管理后台', CLOUD_URL, '行政登录'],
        ['问卷管理', CLOUD_URL + '（登录后点击"问卷需求"）', '查看待处理问卷'],
      ], [20, 55, 25]),
    emptyLine(),
    p('登录账号：admin  密码：admin123'),
    emptyLine(),

    h2('三、操作流程'),
    h3('步骤1：查看问卷需求'),
    p('登录系统后，点击上方"问卷需求"按钮。'),
    p('待处理的问卷会显示在列表中，包含：提交人、实操人员、带教人、期望日期等。'),
    emptyLine(),

    h3('步骤2：导入问卷为台账记录'),
    p('点击"导入登记"按钮，系统会自动填充问卷中的信息。'),
    p('补充以下信息：'),
    bullet('实操人员姓名（确认或修改）'),
    bullet('带教人（确认或修改）'),
    bullet('一级部门（必填）'),
    bullet('二级部门（选填）'),
    bullet('开始日期（确认或修改）'),
    bullet('预计实操天数（确认，如>7天会预警）'),
    bullet('设备型号（如：ThinkPad T14）'),
    bullet('序列号'),
    bullet('配件情况（如：扩展坞、外接显示器）'),
    bullet('备注'),
    p('点击"确认登记"完成。'),
    emptyLine(),

    h3('步骤3：系统自动通知'),
    p('登记完成后，系统自动在企微群发送通知：'),
    bullet('通知内容：新实操人员已登记，请SSC填写薪资'),
    bullet('@对象：@青霖（行政本人）'),
    bullet('如天数>7天，追加用工风险预警@HRD + @全员，提醒HRD关注、SSC提前核算薪资并准备反馈结果收集'),
    emptyLine(),

    h3('步骤4：后续跟踪'),
    p('在管理后台可查看所有实操人员的状态：'),
    bullet('实操中：绿色标签，显示剩余天数'),
    bullet('待反馈：橙色标签，SSC正在跟进'),
    bullet('已反馈：紫色标签，等待办理入职/结算'),
    bullet('已入职/已结算：完结状态'),
    emptyLine(),

    h2('四、注意事项'),
    warningBox('实操天数>7天时，系统会自动发送用工风险预警@HRD + @全员，提醒HRD关注、SSC提前核算薪资并准备反馈结果收集，请务必提醒需求方控制天数。'),
    bullet('行政只能查看人员信息和设备信息，无法查看薪资'),
    bullet('如需修改已登记的信息，点击对应记录的"编辑"按钮'),
    bullet('问卷可"忽略"（如重复提交或无效需求）'),
    bullet('设备信息务必准确填写，包括序列号'),
    emptyLine(),

    h2('五、角色协作'),
    makeTable(['环节', '行政(莫青霖)', 'SSC(Zoe)', 'HRD(massie)'],
      [
        ['需求提交', '等待问卷', '-', '-'],
        ['人员登记', '导入问卷、补充设备', '-', '-'],
        ['薪资录入', '-', '本地工具录入薪资', '-'],
        ['到期跟进', '查看状态', '跟进反馈、记录结果', '-'],
        ['入职/结算', '-', '办理入职或结算', '收到@HRD通知'],
        ['风险预警', '关注>7天预警', '-', '关注逾期3天预警'],
      ], [15, 30, 30, 25]),
  ], '行政操作SOP v3.2');
}

// ==================== Document 5: SSC操作SOP ====================
function createSSCSOP() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'SSC操作SOP', bold: true, size: 36, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: 'Version 3.2  |  2026年7月', size: 20, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h2('一、适用对象'),
    p('SSC（Zoe），负责实操期间的薪资录入、反馈跟进、入职/结算办理。'),
    emptyLine(),

    h2('二、系统入口'),
    makeTable(['入口', '地址', '说明'],
      [
        ['云端管理后台', CLOUD_URL, 'SSC登录，查看人员状态、填写反馈'],
        ['本地SSC工具', 'http://localhost:8080/hr-local.html', '薪资录入与结算，不上云（需先启动本地服务器）'],
        ['问卷表单', Q_URL, '转发给需求方'],
      ], [20, 50, 30]),
    emptyLine(),
    p('云端登录账号：hr  密码：hr666'),
    p('本地工具：用浏览器打开 hr-local.html，输入云端地址：' + CLOUD_URL),
    emptyLine(),

    h2('三、核心操作'),
    h3('3.1 薪资录入（本地工具）'),
    p('⚠ 本地薪资工具需要通过本地服务器运行，不能直接双击打开HTML文件。'),
    emptyLine(),
    h3('步骤1：启动本地服务器'),
    p('在电脑上打开命令行（CMD或PowerShell），执行：'),
    p('cd E:\\实操台账', { bold: true }),
    p('python -m http.server 8080', { bold: true, color: BLUE }),
    p('看到"Serving HTTP on :: ..."提示后，保持窗口不要关闭。'),
    emptyLine(),
    h3('步骤2：打开本地工具'),
    p('用浏览器（推荐Chrome/Edge）访问：'),
    p('http://localhost:8080/hr-local.html', { bold: true, color: BLUE }),
    emptyLine(),
    h3('步骤3：配置云端地址'),
    p('首次打开时，在"云端服务URL"框中输入：'),
    p(CLOUD_URL, { bold: true, color: BLUE }),
    p('点击"连接"。（之后会自动记住，不用重复输入）'),
    emptyLine(),
    h3('步骤4：登录'),
    p('输入以下信息：'),
    bullet('用户名：hr'),
    bullet('密码：hr666'),
    bullet('本地加密口令：自行设置一个密码（如 zoe2026），用于保护本地薪资数据'),
    p('点击"登录"进入主界面。'),
    emptyLine(),
    h3('步骤5：同步云端数据'),
    p('登录后，页面右上角有"🔄 同步云端数据"按钮：'),
    bullet('点击该按钮，从云端拉取最新的实操人员列表'),
    bullet('切换窗口再回来时也会自动同步'),
    bullet('顶栏显示已连接的云端地址和上次同步时间'),
    bullet('只有云端已登记的人员才会出现在列表中'),
    emptyLine(),
    h3('步骤6：登记薪资'),
    p('在列表中找到目标人员，点击"登记薪资"，填写：'),
    bullet('薪资结构描述（如：基本工资+绩效+补贴）'),
    bullet('基本工资（元/月）'),
    bullet('补贴/其他（元/月）'),
    bullet('薪资备注（试用期比例、特殊约定等）'),
    p('保存后，薪资数据仅存在本机浏览器中。'),
    emptyLine(),
    h3('步骤7：导出备份'),
    p('点击右上角"导出数据"按钮，下载JSON备份文件。建议每周备份一次。'),
    emptyLine(),
    warningBox('薪资数据仅存储在本地浏览器中，绝不上传云端！清除浏览器数据将导致丢失，请定期导出备份。'),
    emptyLine(),

    h3('3.2 实操反馈记录（云端后台）'),
    p('实操即将到期时，系统自动提醒：'),
    bullet('T-3（结束前3天）：@SSC 通知，提醒跟进反馈'),
    bullet('T-1（结束前1天）：@SSC 再次提醒'),
    bullet('T-0（到期当天）：通知组长 + @SSC'),
    emptyLine(),
    p('收到提醒后，在云端后台操作：'),
    p('1. 找到对应人员，点击"填写反馈"'),
    p('2. 填写反馈信息：'),
    bullet('反馈结果：通过（建议入职）/ 不通过（结算离场）'),
    bullet('出勤天数、迟到次数、早退次数'),
    bullet('反馈意见'),
    bullet('上传凭证（图片/PDF，最大10MB）'),
    p('3. 提交后，系统自动通知@HRD（massie）+ @全员'),
    emptyLine(),

    h3('3.3 办理入职/结算'),
    p('反馈提交后，状态变为"已反馈"。根据反馈结果：'),
    emptyLine(),
    makeTable(['反馈结果', '操作', '通知', '工具'],
      [
        ['通过', '办理正式入职', '@HRD + @SSC', '云端后台'],
        ['不通过', '办理薪资结算', '@HRD + @全员', '本地SSC工具'],
      ], [20, 25, 25, 30]),
    emptyLine(),
    p('办理入职（云端后台）：'),
    bullet('点击"办理入职"'),
    bullet('填写入职日期'),
    bullet('确认后，系统通知@HRD（massie）+ @SSC（Zoe）'),
    emptyLine(),
    p('办理结算（本地SSC工具）：'),
    bullet('在本地工具点击"办结算"'),
    bullet('确认结算金额（系统自动按日薪计算）'),
    bullet('同时在云端后台点击"办理结算"更新状态'),
    emptyLine(),

    h2('四、企微通知规则（SSC相关）'),
    makeTable(['时间节点', '通知内容', '@对象', 'SSC动作'],
      [
        ['行政登记后', '新实操人员已登记', '@青霖', '登录本地工具录入薪资'],
        ['T-3（结束前3天）', 'XX实操还有3天结束', '@SSC(Zoe)', '开始跟进带教人'],
        ['T-1（结束前1天）', 'XX实操还剩1天', '@SSC(Zoe)', '务必完成反馈记录'],
        ['T-0（到期当天）', 'XX实操今天到期', '组长+@SSC', '记录反馈结果'],
        ['反馈提交后', '反馈结果已提交', '@HRD+@全员', '办理入职或结算'],
        ['逾期3天(T+3)', '已逾期3天，存在劳动风险', '@全员', '立即介入处理'],
        ['办理入职后', 'XX已通过实操', '@HRD+@SSC', '入职流程完成'],
      ], [18, 25, 17, 40]),
    emptyLine(),

    h2('五、注意事项'),
    bullet('薪资数据绝不上云，仅存储在本地浏览器，请定期导出备份'),
    bullet('反馈凭证（纸质反馈表）请拍照上传到云端系统'),
    bullet('逾期3天未反馈的，系统自动@全员预警，需立即处理'),
    bullet('SSC可创建行政账号（但不能创建HRD账号）'),
    bullet('SSC可查看登录日志，审计设备使用情况'),
    emptyLine(),
    tipBox('本地SSC工具地址：http://localhost:8080/hr-local.html（需先执行 python -m http.server 8080 启动）。云端后台地址：' + CLOUD_URL),
  ], 'SSC操作SOP v3.2');
}

// ==================== Document 6: 系统操作指南(完整版) ====================
function createFullGuide() {
  return makeDoc([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: '实操台账系统操作指南', bold: true, size: 40, color: BLUE, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: '完整版  |  Version 3.2  |  2026年7月', size: 20, color: GRAY, font: FONT })] }),
    authorLine(),
    statusBadge(),
    emptyLine(),

    h1('一、系统概述'),
    p('实操台账管理系统是一套面向实操人员全流程管理的云端系统，覆盖从需求提交、行政登记、薪资录入、到期跟进、反馈记录到入职/结算的完整流程。系统通过企微群机器人自动驱动各角色按时完成操作。'),
    emptyLine(),

    h1('二、角色与人员'),
    makeTable(['角色', '人员', '系统账号', '密码', '核心职责'],
      [
        [{text:'需求方',bold:true}, '组长 / 管理层', '-', '-', '发起实操需求，填写问卷表单，须提前>=3天'],
        [{text:'行政',bold:true}, '莫青霖', 'admin', 'admin123', '处理问卷、登记人员信息、录入设备、跟踪状态'],
        [{text:'SSC',bold:true}, 'Zoe', 'hr', 'hr666', '录入薪资（本地不上云）、跟进反馈、办理入职/结算、账号管理'],
        [{text:'HRD',bold:true}, 'massie', 'manager', 'mgr888', '审批正式入职、查看全量数据、关注风险预警、账号管理'],
      ], [12, 15, 12, 12, 49]),
    emptyLine(),

    h1('三、系统入口'),
    makeTable(['入口', '地址', '使用人', '说明'],
      [
        ['问卷表单', Q_URL, '需求方(组长/管理层)', '免登录填写'],
        ['管理后台', CLOUD_URL, '行政/SSC/HRD', '登录后使用'],
        ['反馈表单', CLOUD_URL + '/feedback/:token', '带教人', '免登录填写'],
        ['本地SSC工具', 'http://localhost:8080/hr-local.html', 'SSC(Zoe)', '薪资管理，不上云（需先启动本地服务器）'],
      ], [15, 40, 20, 25]),
    emptyLine(),

    h1('四、数据架构（三层数据隔离）'),
    makeTable(['层级', '存储内容', '位置', '安全性'],
      [
        [{text:'云端系统',bold:true}, '姓名/带教/日期/设备/反馈/状态', CLOUD_URL, '公网访问，不含薪资'],
        [{text:'企微机器人',bold:true}, '只发提醒，不存数据', '企微群', '仅通知转发'],
        [{text:'本地SSC工具',bold:true,color:RED}, '薪资结构/金额', 'SSC个人电脑', '物理隔离，绝不上云'],
      ], [18, 35, 27, 20]),
    p('薪资数据物理隔离，绝不上云。', { color: RED, bold: true }),
    emptyLine(),

    h1('五、企微群机器人通知规则'),
    p('以下所有通知由系统自动推送，无需人工干预。@对象用职位名称（SSC/HRD），行政例外用@青霖：'),
    emptyLine(),
    makeTable(['触发事件', '通知内容', '@对象'],
      NOTIFICATIONS.map(n => [{text:n[0],bold:true}, n[1], n[2]]), [20, 55, 25]),
    emptyLine(),

    h1('六、完整流程'),
    h3('6.1 需求提交（需求方）'),
    bullet('需求方（组长/管理层）打开问卷表单：' + Q_URL),
    bullet('填写实操人员信息（姓名、带教人、一级部门、二级部门、天数等）'),
    bullet('须提前>=3天提交'),
    bullet('提交后系统自动@全员通知'),
    emptyLine(),

    h3('6.2 行政登记（行政 莫青霖）'),
    bullet('登录管理后台：' + CLOUD_URL + '（admin / admin123）'),
    bullet('点击"问卷需求"查看待处理问卷'),
    bullet('点击"导入登记"，确认/补充一级部门、二级部门、设备信息'),
    bullet('如天数>7天，系统自动发送用工风险预警@HRD + @全员，提醒SSC提前核算薪资并准备反馈结果收集'),
    bullet('登记后系统自动@青霖通知'),
    emptyLine(),

    h3('6.3 薪资录入（SSC Zoe）'),
    p('⚠ 本地薪资工具需通过本地服务器运行，不能直接双击HTML文件。'),
    bullet('步骤1：打开命令行，执行 cd E:\\实操台账'),
    bullet('步骤2：执行 python -m http.server 8080 启动本地服务器'),
    bullet('步骤3：浏览器访问 http://localhost:8080/hr-local.html'),
    bullet('步骤4：输入云端地址 ' + CLOUD_URL + '，点击"连接"'),
    bullet('步骤5：登录（用户名 hr，密码 hr666），设置本地加密口令'),
    bullet('步骤6：点击右上角"🔄 同步云端数据"按钮拉取人员列表'),
    bullet('步骤7：找到目标人员，点击"登记薪资"，填写薪资结构、基本工资、补贴等'),
    bullet('步骤8：定期点击"导出数据"备份薪资数据'),
    warningBox('薪资数据仅存储在本地浏览器，绝不上云。清除浏览器数据将导致丢失，请定期导出备份。'),
    emptyLine(),

    h3('6.4 到期跟进（SSC Zoe）'),
    p('系统自动按时间节点发送企微通知：'),
    makeTable(['时间', '通知内容', '@对象', 'SSC动作'],
      [
        ['T-3（结束前3天）', 'XX实操还有3天结束', '@SSC(Zoe)', '开始跟进带教人'],
        ['T-1（结束前1天）', 'XX实操还剩1天', '@SSC(Zoe)', '务必完成反馈记录'],
        ['T-0（到期当天）', 'XX实操今天到期', '组长+@SSC', '记录反馈结果'],
        ['T+3（逾期3天）', '已逾期3天，存在劳动风险', '@全员', '立即介入处理'],
      ], [20, 25, 17, 38]),
    emptyLine(),

    h3('6.5 反馈记录（SSC Zoe）'),
    bullet('在云端后台找到对应人员，点击"填写反馈"'),
    bullet('选择反馈结果：通过（建议入职）/ 不通过（结算离场）'),
    bullet('填写出勤记录、反馈意见'),
    bullet('上传凭证附件（图片/PDF，最大10MB）'),
    bullet('提交后，系统自动通知@HRD（massie）+ @全员'),
    emptyLine(),

    h3('6.6 入职/结算（SSC Zoe + HRD massie）'),
    p('反馈通过：'),
    bullet('SSC在云端后台点击"办理入职"'),
    bullet('填写入职日期'),
    bullet('系统通知@HRD（massie）+ @SSC（Zoe）'),
    emptyLine(),
    p('反馈不通过：'),
    bullet('SSC在本地工具点击"办结算"'),
    bullet('确认结算金额（系统自动按日薪计算）'),
    bullet('在云端后台点击"办理结算"更新状态'),
    bullet('系统通知@HRD（massie）+ @全员'),
    emptyLine(),

    h1('七、劳动风险防控'),
    bullet('实操天数严格控制在7天以内，超过需HRD审批'),
    bullet('实操期间不签订劳动合同，以"实操评估"名义进行'),
    bullet('实操结束当天必须有明确结论：通过->入职 或 不通过->结算离场'),
    bullet('逾期未反馈的，T+3自动升级到全员+劳动风险预警'),
    bullet('薪资数据绝不上云，物理隔离，防止数据泄露'),
    bullet('所有操作留痕，系统记录操作人、时间、来源'),
    emptyLine(),

    h1('八、系统账号'),
    makeTable(['角色', '人员', '用户名', '密码'],
      [
        ['行政', '莫青霖', 'admin', 'admin123'],
        ['SSC', 'Zoe', 'hr', 'hr666'],
        ['HRD', 'massie', 'manager', 'mgr888'],
      ], [20, 25, 25, 30]),
    emptyLine(),
    tipBox('系统已部署上线：' + CLOUD_URL + ' 。问卷表单地址：' + Q_URL + ' 。'),
  ], '系统操作指南(完整版) v3.2');
}

// ==================== Generate All ====================
async function generate() {
  const outDir = path.join(__dirname, 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const docs = [
    { fn: createSOP, name: '实操人员管理SOP_v3_简版.docx' },
    { fn: createLeadershipGuide, name: '领导决策摘要.docx' },
    { fn: createRequesterSOP, name: '需求方操作SOP.docx' },
    { fn: createAdminSOP, name: '行政操作SOP.docx' },
    { fn: createSSCSOP, name: 'SSC操作SOP.docx' },
    { fn: createFullGuide, name: '系统操作指南(完整版).docx' },
  ];

  let ok = 0, fail = 0;
  const tmpDir = path.join(outDir, 'tmp_update');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const d of docs) {
    try {
      const doc = d.fn();
      const buf = await Packer.toBuffer(doc);
      const filePath = path.join(outDir, d.name);
      fs.writeFileSync(filePath, buf);
      console.log('Generated:', d.name, '-', buf.length, 'bytes');
      ok++;
    } catch(e) {
      try {
        const doc = d.fn();
        const buf = await Packer.toBuffer(doc);
        const tmpPath = path.join(tmpDir, d.name);
        fs.writeFileSync(tmpPath, buf);
        console.log('Generated (tmp):', d.name, '-', buf.length, 'bytes');
        ok++;
      } catch(e2) {
        console.log('SKIP (failed):', d.name, '-', e2.code);
        fail++;
      }
    }
  }

  console.log('\nDone! ' + ok + ' generated, ' + fail + ' skipped. Directory:', outDir);
  if (fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length > 0) {
    console.log('Some files in tmp_update/ - please close Word and copy them to docs/');
  }
}

generate().catch(e => { console.error(e); process.exit(1); });
