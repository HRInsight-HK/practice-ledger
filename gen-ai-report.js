const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');

const FONT = 'Microsoft YaHei';
const BLUE = '1a56c4', DARK = '1a1a2e', GRAY = '666666', GREEN_TEXT = '065f46', GREEN_BG = 'd1fae5';

function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, children: [new TextRun({ text: t, bold: true, size: 26, color: BLUE, font: FONT })] }); }
function p(t, o = {}) { return new Paragraph({ spacing: { before: 60, after: 60 }, alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: t, size: 21, font: FONT, ...o })] }); }
function bullet(t) { return new Paragraph({ spacing: { before: 40, after: 40 }, bullet: { level: 0 }, children: [new TextRun({ text: t, size: 21, font: FONT })] }); }
function emptyLine() { return new Paragraph({ spacing: { before: 80, after: 80 }, children: [] }); }

function safeBox(t) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: GREEN_BG }, margins: { top: 80, bottom: 80, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: t, size: 21, font: FONT, color: GREEN_TEXT, bold: true })] })] })] })] });
}

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { before: 60, after: 60 } } } } },
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '第 ', size: 16, color: GRAY, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: FONT }), new TextRun({ text: ' 页', size: 16, color: GRAY, font: FONT })] })] }) },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: 'AI训练营学习成果汇报', bold: true, size: 40, color: BLUE, font: FONT })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 }, children: [new TextRun({ text: '汇报人：Zoe（SSC）  |  2026年8月', size: 20, color: GRAY, font: FONT })] }),
      emptyLine(),

      h2('一、背景'),
      p('参加公司组织的AI训练营，系统学习了AI工具在日常办公与人事工作中的应用方法。培训期间坚持"学以致用"，边学边将AI能力落地到SSC实际工作中，目前已有多个场景跑通并稳定使用，特此汇报。'),
      emptyLine(),

      h2('二、学习成果与实际应用'),
      p('1. 实操人员全流程管理系统（已上线运行）', { bold: true }),
      p('搭建实操人员从需求提交、行政登记、到期提醒到入职/结算的云端管理系统，关键节点由企微机器人自动提醒，全程无需人工催办，信息实时同步，杜绝遗漏和用工风险。'),
      p('2. 入职资料一键生成', { bold: true }),
      p('编写自动化脚本，读取花名册即可一键生成全部7份入职文档（劳动合同、保密协议、物品签收表等）。原先逐份手工填写需数小时，现在分钟级完成，且从源头杜绝填错。'),
      p('3. 月度考勤自动化处理', { bold: true }),
      p('百人以上规模的月度考勤、加班费、迟到扣款、调休全部由脚本自动计算，自动备份原始表格并追加核验环节。原先2-3天的手工核算压缩到1小时内，准确率大幅提升。'),
      p('4. 部门人效分析仪表盘', { bold: true }),
      p('搭建可视化数据看板，对公司各部门工作量与人效进行动态分析，管理层可实时查看数据，为编制与资源分配决策提供依据。'),
      p('5. 制度文档标准化维护', { bold: true }),
      p('SOP等7份制度文档实现脚本一键生成，内容修订后分钟级同步全部版本，保证各角色拿到的永远是最新版。'),
      emptyLine(),

      h2('三、成效小结'),
      bullet('重复性事务工作时间大幅压缩，SSC人力释放到更有价值的分析与服务上'),
      bullet('核心流程线上化、留痕化，出错率与遗漏率显著下降'),
      bullet('数据可视化，管理层实时掌握人效动态，决策有据'),
      emptyLine(),

      h2('四、数据安全说明'),
      p('所有AI应用均遵循以下原则，无数据安全风险：'),
      bullet('薪资等敏感数据存储在本地加密工具中，绝不上云、绝不经手AI工具'),
      bullet('AI仅用于流程搭建、文档处理、数据统计等非敏感场景'),
      bullet('公司系统部署在自有云端账号，数据权限分级管理'),
      emptyLine(),
      safeBox('结论：AI工具已深度融入日常工作且运行稳定，敏感数据物理隔离，无安全风险。'),
      emptyLine(),

      h2('五、后续计划'),
      bullet('将AI能力继续扩展到更多人事场景（招聘协作、考勤分析自动化、报表生成等）'),
      bullet('逐步沉淀为SSC标准化数字工作流，形成可复制的经验向团队推广'),
      emptyLine(),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = 'C:\\Users\\EDY\\Desktop\\AI训练营学习成果汇报.docx';
  fs.writeFileSync(out, buf);
  console.log('Generated:', out, '-', buf.length, 'bytes');
});
