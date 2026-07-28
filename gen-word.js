const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak, LevelFormat, convertInchesToTwip, TabStopType, TabStopPosition
} = require('docx');
const fs = require('fs');
const path = require('path');

// ==================== Helpers ====================

const COLORS = {
  primary: '2B579A',
  header: 'D6E4F0',
  headerText: '1A1A1A',
  altRow: 'F2F7FC',
  white: 'FFFFFF',
  red: 'DC2626',
  green: '16A34A',
  warning: 'FEF3C7',
  warningText: '92400E',
  border: 'B4C6E7'
};

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function heading(text, level = HeadingLevel.HEADING_1, opts = {}) {
  return new Paragraph({
    heading: level,
    spacing: { before: opts.before ?? 280, after: opts.after ?? 140 },
    children: [new TextRun({ text, bold: true, color: COLORS.primary, size: level === HeadingLevel.HEADING_1 ? 32 : level === HeadingLevel.HEADING_2 ? 28 : 24 })]
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 60, after: opts.after ?? 60 },
    alignment: opts.align || AlignmentType.LEFT,
    indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
    children: [new TextRun({ text, size: opts.size || 22, bold: opts.bold || false, color: opts.color || '333333', italics: opts.italic || false })]
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { before: 30, after: 30 },
    bullet: { level },
    children: [new TextRun({ text, size: 22, color: '333333' })]
  });
}

function checkbox(text) {
  return new Paragraph({
    spacing: { before: 30, after: 30 },
    indent: { left: convertInchesToTwip(0.3) },
    children: [new TextRun({ text: '[  ] ' + text, size: 22, color: '333333' })]
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: '' })] });
}

function makeCell(text, opts = {}) {
  const isHeader = opts.header || false;
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, fill: isHeader ? COLORS.header : (opts.alt ? COLORS.altRow : COLORS.white) },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text: String(text || ''),
        size: 20,
        bold: isHeader || opts.bold || false,
        color: isHeader ? COLORS.headerText : (opts.color || '333333')
      })]
    })]
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => makeCell(h, { header: true, width: colWidths?.[i], align: AlignmentType.CENTER }))
  });

  const dataRows = rows.map((row, idx) =>
    new TableRow({
      children: row.map((cell, i) => {
        const opts = { alt: idx % 2 === 1 };
        if (colWidths?.[i]) opts.width = colWidths[i];
        if (typeof cell === 'object' && cell.text) {
          opts.bold = cell.bold;
          opts.color = cell.color;
          return makeCell(cell.text, opts);
        }
        return makeCell(cell, opts);
      })
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder,
      insideHorizontal: thinBorder, insideVertical: thinBorder
    },
    rows: [headerRow, ...dataRows]
  });
}

function warningBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: COLORS.warning },
        margins: { top: 100, bottom: 100, left: 200, right: 200 },
        borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'FCD34D' }, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'FCD34D' }, left: { style: BorderStyle.SINGLE, size: 3, color: 'F59E0B' }, right: { style: BorderStyle.SINGLE, size: 1, color: 'FCD34D' } },
        children: [new Paragraph({ children: [new TextRun({ text, size: 22, color: COLORS.warningText, bold: true })] })]
      })]
    })]
  });
}

function infoBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: 'EBF5FF' },
        margins: { top: 80, bottom: 80, left: 200, right: 200 },
        borders: { top: noBorder, bottom: noBorder, left: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary }, right: noBorder },
        children: [new Paragraph({ children: [new TextRun({ text, size: 22, color: '1E40AF' })] })]
      })]
    })]
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// Document header/footer
function docHeader(title) {
  return {
    default: {
      headers: {
        default: new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: title, size: 18, color: '999999', italics: true })]
        })
      },
      footers: {
        default: new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Page ', size: 18, color: '999999' }), new TextRun({ children: [''], size: 18, color: '999999' })]
        })
      }
    }
  };
}

// ==================== Document 1: 需求方SOP ====================
function buildRequestorSOP() {
  const children = [
    // Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
      children: [new TextRun({ text: '需求方操作 SOP', bold: true, size: 44, color: COLORS.primary })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '实操人员需求登记 — 标准操作流程', size: 24, color: '666666' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: '版本 v2.0  |  生效日期：2026年7月  |  适用范围：管理层 / 组长 / 员工', size: 20, color: '999999' })]
    }),

    heading('一、适用对象', HeadingLevel.HEADING_1),
    para('本文档适用于所有需要安排实操人员到岗的人员，包括但不限于：'),
    bullet('管理层：因业务需要安排人员实操'),
    bullet('组长：团队需要新增实操人员'),
    bullet('员工：推荐或需要安排实操人员'),
    emptyLine(),

    heading('二、流程概述', HeadingLevel.HEADING_1),
    para('需求方的核心职责是：通过问卷表单提交实操需求，提供完整的信息（尤其是带教人），由行政据此登记入台账系统。'),
    emptyLine(),

    para('整体流程：', { bold: true }),
    para('需求方填写问卷  →  企微群通知行政  →  行政登记入系统  →  HR 填写薪资  →  实操进行  →  带教人反馈  →  入职/结算', { indent: 0.3, color: '555555' }),
    emptyLine(),

    heading('三、操作步骤', HeadingLevel.HEADING_1),

    heading('3.1 打开问卷表单', HeadingLevel.HEADING_2),
    para('浏览器访问问卷地址（由行政或 IT 提供，部署后为云端地址）。'),
    infoBox('无需账号密码，直接打开填写。'),
    emptyLine(),

    heading('3.2 填写问卷信息', HeadingLevel.HEADING_2),
    para('逐项填写以下内容：', { bold: true }),
    emptyLine(),

    makeTable(
      ['字段', '是否必填', '说明', '示例'],
      [
        ['提交人姓名', '必填', '您自己的姓名', '王总'],
        ['身份', '必填', '点击选择：管理层 / 组长 / 员工', '管理层'],
        ['实操人员姓名', '必填', '需要安排实操的人员全名', '张三'],
        [{ text: '建议带教人', bold: true, color: COLORS.red }, { text: '必填', bold: true, color: COLORS.red }, '直接带教负责人，必须填写', '李主管'],
        ['期望开始日期', '必填', '期望到岗日期（点击日历选择）', '2026-07-28'],
        ['预计实操天数', '必填', '预估实操天数（≥1）', '7'],
        ['业务方向', '选填', '负责什么业务', '新零售-门店运营'],
        ['设备需求', '选填', '需要配发什么设备', '笔记本电脑、扩展坞'],
        ['备注', '选填', '其他需要说明的事项', '重点培养对象']
      ],
      [15, 12, 48, 25]
    ),
    emptyLine(),

    heading('3.3 提交问卷', HeadingLevel.HEADING_2),
    bullet('确认信息无误后，点击「提交需求」按钮'),
    bullet('系统显示提交成功页面，确认已提交的信息'),
    bullet('企微群自动通知行政「新的实操需求已提交」'),
    bullet('行政将在 1 个工作日内完成登记'),
    emptyLine(),

    heading('四、红线规则', HeadingLevel.HEADING_1),
    warningBox('建议带教人必填！如果不知道带教人是谁，请先确认后再提交。未填写带教人的问卷，行政不予登记。'),
    emptyLine(),

    heading('五、注意事项', HeadingLevel.HEADING_1),
    bullet('信息尽量完整：业务方向、设备需求、备注虽为选填，但填写越完整，行政登记越准确'),
    bullet('日期要准确：期望开始日期应与实际到岗日期一致，如有变动及时通知行政'),
    bullet('天数要合理：一般实操周期 3-15 天，特殊情况可适当延长'),
    bullet('提交后跟进：提交后可在企微群关注通知，确认行政是否已完成登记'),
    bullet('紧急需求：如遇紧急情况，提交问卷后直接联系行政或 HR 加速处理'),
    emptyLine(),

    heading('六、常见问题', HeadingLevel.HEADING_1),
    makeTable(
      ['问题', '解答'],
      [
        ['不知道带教人是谁怎么办？', '请先与业务负责人确认带教人后再提交问卷。带教人是必填项。'],
        ['提交后发现信息填错了？', '请联系行政在系统中修改，或重新提交一份正确的问卷并说明。'],
        ['行政多久能处理完？', '正常情况下 1 个工作日内完成登记。超时请联系行政或 HR。'],
        ['需要修改已提交的问卷？', '问卷提交后无法自行修改，请联系行政处理。'],
        ['可以不填问卷直接找行政吗？', '建议通过问卷提交，确保信息可追溯。紧急情况可直接联系行政。']
      ],
      [40, 60]
    ),
    emptyLine(),

    heading('七、提交后自查清单', HeadingLevel.HEADING_1),
    checkbox('提交人姓名已填写'),
    checkbox('身份已选择（管理层/组长/员工）'),
    checkbox('实操人员姓名已填写'),
    checkbox('建议带教人已填写（必填！）'),
    checkbox('期望开始日期已选择'),
    checkbox('预计天数已填写'),
    checkbox('业务方向已填写（建议填写）'),
    checkbox('设备需求已填写（如需配发设备）'),
  ];

  return new Document({
    creator: '实操台账系统',
    title: '需求方操作SOP',
    description: '实操人员需求登记标准操作流程',
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 22 }
        }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } }
      },
      children
    }]
  });
}

// ==================== Document 2: 行政SOP ====================
function buildAdminSOP() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
      children: [new TextRun({ text: '行政操作 SOP', bold: true, size: 44, color: COLORS.primary })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '实操人员台账管理 — 行政侧标准操作流程', size: 24, color: '666666' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: '版本 v2.0  |  生效日期：2026年7月  |  适用角色：行政', size: 20, color: '999999' })]
    }),

    heading('一、角色定位', HeadingLevel.HEADING_1),
    para('行政是实操人员台账的「入口管理者」，负责：'),
    bullet('接收并处理需求方提交的问卷'),
    bullet('将问卷信息导入系统，登记实操人员基础信息'),
    bullet('登记设备型号、序列号、配件等信息'),
    bullet('维护基础信息的准确性（可编辑修改）'),
    emptyLine(),
    warningBox('行政看不到薪资金额、反馈详情、结算金额。行政只能看到流程状态标志（是否已登记薪资、是否已反馈等）。'),
    emptyLine(),

    heading('二、登录系统', HeadingLevel.HEADING_1),

    heading('2.1 登录信息', HeadingLevel.HEADING_2),
    makeTable(
      ['字段', '填写内容'],
      [
        ['用户名', 'admin'],
        ['密码', 'admin123'],
        ['设备型号', '如：ThinkPad T14'],
        ['配件', '如：扩展坞、外接显示器'],
        ['序列号', '设备序列号']
      ],
      [30, 70]
    ),
    emptyLine(),
    warningBox('首次登录后请尽快修改密码（联系 HR 在账号管理中修改）。设备信息每次登录都会记录，用于审计追溯。'),
    emptyLine(),

    heading('2.2 登录后界面', HeadingLevel.HEADING_2),
    para('登录成功后，你将看到：'),
    bullet('顶部栏：系统名称 + 「行政」角色标签 + 你的姓名 + 退出按钮'),
    bullet('统计卡片：总人数、实操中、待反馈、已反馈、需关注'),
    bullet('筛选标签：全部 / 实操中 / 待反馈 / 已反馈 / 已完结'),
    bullet('工具栏：搜索框 + 「问卷需求」按钮 + 「导出」按钮 + 「登记实操人员」按钮'),
    bullet('数据表格：所有实操人员列表'),
    emptyLine(),

    heading('三、处理问卷需求（核心工作）', HeadingLevel.HEADING_1),

    heading('3.1 查看待处理问卷', HeadingLevel.HEADING_2),
    para('操作步骤：'),
    bullet('点击顶部「问卷需求」按钮'),
    bullet('弹出问卷列表窗口，分为两部分：'),
    para('待处理（橙色标题）：需求方提交但尚未登记的问卷', { indent: 0.5 }),
    para('已导入（绿色标题）：已登记的问卷', { indent: 0.5 }),
    emptyLine(),

    heading('3.2 导入问卷为台账记录', HeadingLevel.HEADING_2),
    para('操作步骤：'),
    bullet('在「待处理」区域找到需要处理的问卷'),
    bullet('确认问卷信息：提交人、实操人员姓名、建议带教人、期望日期、天数、设备需求等'),
    bullet('点击「导入登记」按钮'),
    bullet('弹出导入表单，系统已自动带入问卷中的信息'),
    bullet('逐项确认/修改以下字段：'),
    emptyLine(),

    makeTable(
      ['字段', '说明', '是否必填'],
      [
        ['实操人员姓名', '可修改（问卷可能有错别字）', '必填'],
        ['带教人', '可修改（需求方建议的可能需调整）', '必填'],
        ['开始日期', '实际到岗日期', '必填'],
        ['预计实操天数', '预估天数', '必填'],
        ['设备型号', '行政现场登记', '选填'],
        ['序列号', '行政现场登记', '选填'],
        ['配件情况', '行政现场登记', '选填'],
        ['备注', '合并问卷备注', '选填']
      ],
      [25, 55, 20]
    ),
    emptyLine(),
    bullet('确认无误后点击「确认登记」'),
    bullet('系统提示「已导入并登记成功」'),
    bullet('企微群自动通知「新实操人员已登记」'),
    emptyLine(),

    heading('3.3 忽略无效问卷', HeadingLevel.HEADING_2),
    para('如果问卷无效（重复提交、信息错误等），点击「忽略」按钮，问卷从待处理列表消失。'),
    emptyLine(),

    heading('四、手动登记实操人员', HeadingLevel.HEADING_1),
    para('如果不通过问卷，直接手动登记：'),
    bullet('点击「登记实操人员」按钮'),
    bullet('填写实操人员信息（姓名、带教人、开始日期、天数、设备等）'),
    bullet('点击「保存」'),
    emptyLine(),
    infoBox('建议优先使用问卷导入方式，确保信息来源可追溯。'),
    emptyLine(),

    heading('五、编辑已有记录', HeadingLevel.HEADING_1),
    para('操作步骤：'),
    bullet('在数据表格中找到目标人员'),
    bullet('点击操作列的「编辑」按钮'),
    bullet('修改需要变更的字段'),
    bullet('点击「保存」'),
    emptyLine(),

    heading('六、查看人员详情', HeadingLevel.HEADING_1),
    para('点击操作列的「详情」按钮，弹出详情窗口，包含：'),
    bullet('流程进度条：行政登记 → 实操进行中 → 带教反馈 → 结算/入职'),
    bullet('基本信息：姓名、带教人、日期、天数、设备信息'),
    bullet('流程进度：薪资是否已登记（只看到"已登记/待登记"标志，看不到金额）、反馈是否已提交、是否已结算/入职'),
    emptyLine(),
    warningBox('行政只能看到流程状态标志，看不到薪资金额、反馈详情、结算金额。'),
    emptyLine(),

    heading('七、导出数据', HeadingLevel.HEADING_1),
    bullet('点击「导出」按钮'),
    bullet('系统自动下载 CSV 文件，文件名格式：实操台账_日期.csv'),
    bullet('导出内容包含：姓名、带教人、日期、天数、设备、状态'),
    warningBox('行政导出的数据不含薪资信息。'),
    emptyLine(),

    heading('八、搜索与筛选', HeadingLevel.HEADING_1),
    bullet('搜索：在搜索框输入姓名或带教人，实时筛选'),
    bullet('筛选标签：点击「全部 / 实操中 / 待反馈 / 已反馈 / 已完结」快速切换视图'),
    emptyLine(),

    heading('九、门禁规则', HeadingLevel.HEADING_1),
    para('系统在登记时会进行校验，以下字段不填写将无法登记：'),
    makeTable(
      ['校验项', '规则', '不通过的处理'],
      [
        ['带教人', '必填（问卷 + 登记）', '不予登记，提示先确认带教人'],
        ['实操人员姓名', '必填', '不予登记'],
        ['开始日期', '必填', '不予登记'],
        ['预计天数', '必填，≥1', '不予登记']
      ],
      [30, 40, 30]
    ),
    emptyLine(),

    heading('十、异常处理', HeadingLevel.HEADING_1),
    makeTable(
      ['异常场景', '处理方式', '责任人'],
      [
        ['需求方不给带教人信息', '问卷必填校验拦截；行政拒绝登记', '行政'],
        ['问卷提交后行政未及时处理', '企微群已通知，超 1 工作日 HR 跟进', '行政 → HR'],
        ['带教人离职/调岗，无法反馈', '通知 HR 在系统中更新带教人', '行政 → HR'],
        ['实操需延长', '通知 HR 修改预计天数', '行政 → HR'],
        ['实操中途终止', '通知 HR 直接办理结算', '行政 → HR']
      ],
      [35, 45, 20]
    ),
    emptyLine(),

    heading('十一、行政权限总结', HeadingLevel.HEADING_1),
    makeTable(
      ['操作', '权限'],
      [
        [{ text: '可以', bold: true, color: COLORS.green }, ''],
        ['查看/处理问卷', '可以'],
        ['登记实操人员', '可以'],
        ['编辑基础信息', '可以'],
        ['查看流程状态', '可以'],
        ['导出数据（无薪资）', '可以'],
        [{ text: '不可以', bold: true, color: COLORS.red }, ''],
        ['查看薪资金额', '不可以'],
        ['查看反馈详情', '不可以'],
        ['查看结算金额', '不可以'],
        ['填写反馈', '不可以'],
        ['办理结算/入职', '不可以'],
        ['管理账号', '不可以']
      ],
      [60, 40]
    ),
    emptyLine(),

    heading('十二、行政登记自查清单', HeadingLevel.HEADING_1),
    checkbox('问卷信息已确认（姓名、带教人无误）'),
    checkbox('设备型号、序列号、配件已填写'),
    checkbox('开始日期与实际到岗一致'),
    checkbox('预计天数合理'),
    checkbox('带教人字段已填写（门禁校验）'),
  ];

  return new Document({
    creator: '实操台账系统',
    title: '行政操作SOP',
    description: '实操人员台账管理 - 行政侧标准操作流程',
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      children
    }]
  });
}

// ==================== Document 3: 人事SOP ====================
function buildHRSOP() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
      children: [new TextRun({ text: '人事（HR）操作 SOP', bold: true, size: 44, color: COLORS.primary })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '实操人员全生命周期管理 — HR 侧标准操作流程', size: 24, color: '666666' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: '版本 v2.0  |  生效日期：2026年7月  |  适用角色：HR', size: 20, color: '999999' })]
    }),

    heading('一、角色定位', HeadingLevel.HEADING_1),
    para('HR 是实操人员台账的「全流程管理者」，拥有最高数据权限，负责：'),
    bullet('登记薪资信息（本地工具，不上云）'),
    bullet('推进反馈流程（代录或督促带教人提交）'),
    bullet('办理结算 / 入职手续'),
    bullet('账号管理（新增/删除/重置密码）'),
    bullet('查看登录日志（安全审计）'),
    bullet('修改实操天数（延长/缩短）'),
    emptyLine(),
    infoBox('HR 拥有全量数据读写权限，包括薪资、反馈、结算、入职等所有信息。'),
    emptyLine(),

    heading('二、登录系统', HeadingLevel.HEADING_1),
    makeTable(
      ['字段', '填写内容'],
      [
        ['用户名', 'hr'],
        ['密码', 'hr666'],
        ['设备型号', '填写当前使用设备'],
        ['配件', '填写配件信息'],
        ['序列号', '填写设备序列号']
      ],
      [30, 70]
    ),
    emptyLine(),
    warningBox('首次登录后请修改密码。设备信息每次登录都会记录，用于审计追溯。'),
    emptyLine(),
    para('HR 登录后比行政多以下功能：'),
    bullet('账号管理按钮：管理所有系统账号'),
    bullet('登录日志按钮：查看所有登录记录'),
    bullet('表格中多一列「薪资结构」'),
    bullet('操作列有更多按钮：填写反馈、办理入职、办理结算、删除'),
    emptyLine(),

    heading('三、薪资登记（本地工具）', HeadingLevel.HEADING_1),

    heading('3.1 为什么薪资在本地', HeadingLevel.HEADING_2),
    warningBox('薪资属于保密信息，绝不上云。薪资数据存储在 HR 本地电脑中，通过本地工具管理。云端系统完全不包含薪资字段。'),
    emptyLine(),

    heading('3.2 使用本地 HR 工具', HeadingLevel.HEADING_2),
    para('操作步骤：'),
    bullet('在 HR 电脑上用浏览器打开 hr-local.html（本地文件）'),
    bullet('输入云端系统地址和 HR 账号密码'),
    bullet('工具自动拉取云端台账数据'),
    bullet('为每条记录填写薪资信息：'),
    emptyLine(),

    makeTable(
      ['字段', '说明', '示例'],
      [
        ['薪资结构描述', '薪资构成方式', '基本工资+绩效+补贴'],
        ['基本工资', '元/月', '8000'],
        ['补贴/其他', '元/月', '1500'],
        ['薪资备注', '薪资说明、发放方式等', '试用期8折，转正后全额']
      ],
      [25, 40, 35]
    ),
    emptyLine(),
    bullet('薪资数据存储在本地 localStorage 中，使用 AES 加密'),
    bullet('可随时导出 JSON 备份'),
    emptyLine(),

    heading('3.3 时限要求', HeadingLevel.HEADING_2),
    warningBox('行政登记后 1 个工作日内完成薪资登记。未登记薪资的人员，HR 应优先处理。'),
    emptyLine(),

    heading('四、查看和处理问卷', HeadingLevel.HEADING_1),
    para('HR 也可以查看和处理问卷（同行政操作），点击「问卷需求」按钮即可。'),
    emptyLine(),

    heading('五、推进反馈', HeadingLevel.HEADING_1),

    heading('5.1 HR 代录反馈', HeadingLevel.HEADING_2),
    para('当带教人无法通过线上表单提交反馈时，HR 可以代录：'),
    bullet('在数据表格中找到状态为「实操中」或「待反馈」的人员'),
    bullet('点击「填写反馈」按钮'),
    bullet('选择反馈结果：'),
    para('通过 — 建议入职', { indent: 0.5, color: COLORS.green, bold: true }),
    para('不通过 — 结算离场', { indent: 0.5, color: COLORS.red, bold: true }),
    bullet('填写反馈意见'),
    bullet('点击「提交反馈」'),
    emptyLine(),
    infoBox('系统会标记反馈来源为 hr_manual（HR 代录），与带教人自行提交（mentor_form）区分。'),
    emptyLine(),

    heading('5.2 带教人自行提交反馈', HeadingLevel.HEADING_2),
    para('带教人通过企微群机器人推送的链接直接填写，HR 无需介入。提交后企微群自动通知 HR。'),
    emptyLine(),

    heading('六、办理结算', HeadingLevel.HEADING_1),
    para('当反馈结果为「不通过」时：'),
    bullet('在数据表格中找到状态为「已反馈」且结果为不通过的人员'),
    bullet('点击「办理结算」按钮'),
    bullet('填写结算信息：'),
    emptyLine(),

    makeTable(
      ['字段', '说明'],
      [
        ['结算日期', '实际结算日期'],
        ['结算金额', '系统自动按日折算（基本工资+补贴）/30*天数，可手动修改'],
        ['备注', '结算说明']
      ],
      [25, 75]
    ),
    emptyLine(),
    bullet('点击「确认办理」'),
    bullet('状态变为「已结算」'),
    bullet('企微群通知「请HR办理薪资结算」'),
    emptyLine(),
    warningBox('反馈不通过后 3 个工作日内完成结算。'),
    emptyLine(),

    heading('七、办理入职', HeadingLevel.HEADING_1),
    para('当反馈结果为「通过」时：'),
    bullet('在数据表格中找到状态为「已反馈」且结果为通过的人员'),
    bullet('点击「办理入职」按钮'),
    bullet('填写入职信息：'),
    emptyLine(),

    makeTable(
      ['字段', '说明'],
      [
        ['入职日期', '实际签订劳动合同日期'],
        ['备注', '入职说明']
      ],
      [25, 75]
    ),
    emptyLine(),
    bullet('点击「确认办理」'),
    bullet('状态变为「已入职」'),
    bullet('企微群通知「请HR办理入职手续」'),
    emptyLine(),

    warningBox('劳动合同时限红线：\n1. 反馈通过后 3 个工作日内签订劳动合同\n2. 超过 5 个工作日未签合同，系统标红预警，HR 须说明原因\n3. 根据《劳动合同法》，超一个月未签合同须支付二倍工资'),
    emptyLine(),

    heading('八、修改实操天数', HeadingLevel.HEADING_1),
    para('当实操需要延长或缩短时：'),
    bullet('点击该人员操作列的「编辑」按钮'),
    bullet('修改「预计实操天数」'),
    bullet('系统自动重新计算结束日期'),
    bullet('保存后生效'),
    emptyLine(),

    heading('九、账号管理', HeadingLevel.HEADING_1),

    heading('9.1 查看所有账号', HeadingLevel.HEADING_2),
    bullet('点击顶部「账号管理」按钮'),
    bullet('查看所有系统账号列表（用户名、姓名、角色、企微号、状态）'),
    emptyLine(),

    heading('9.2 新增账号', HeadingLevel.HEADING_2),
    bullet('在账号管理窗口下方「新增账号」区域填写：'),
    para('用户名（必填）', { indent: 0.5 }),
    para('密码（必填）', { indent: 0.5 }),
    para('姓名（必填）', { indent: 0.5 }),
    para('企微号（选填）', { indent: 0.5 }),
    para('角色（行政/HR/管理层）', { indent: 0.5 }),
    bullet('点击「新增账号」'),
    emptyLine(),

    heading('9.3 删除账号', HeadingLevel.HEADING_2),
    bullet('在账号列表中点击对应用号旁的「删除」按钮'),
    bullet('确认后删除'),
    infoBox('HR 可以删除除 manager 外的所有账号。'),
    emptyLine(),

    heading('十、查看登录日志', HeadingLevel.HEADING_1),
    bullet('点击顶部「登录日志」按钮'),
    bullet('查看所有登录记录：账号、姓名、角色、设备型号、配件、序列号、登录时间'),
    bullet('用于安全审计，追溯每次登录的设备信息'),
    emptyLine(),

    heading('十一、导出数据', HeadingLevel.HEADING_1),
    para('HR 导出的 CSV 包含完整信息：'),
    bullet('基础信息 + 薪资结构 + 基本工资 + 补贴 + 反馈结果 + 结算金额 + 入职日期'),
    emptyLine(),

    heading('十二、企微群机器人提醒机制', HeadingLevel.HEADING_1),
    para('系统自动在以下场景向企微群推送通知：'),
    makeTable(
      ['场景', '触发时机', '通知内容'],
      [
        ['新需求提交', '需求方提交问卷', '"新的实操需求已提交，请行政尽快登记"'],
        ['新人员登记', '行政导入问卷', '"新实操人员已登记，请HR填写薪资"'],
        ['即将到期 T-3', '结束前3天', '"XX的实操还有3天到期，请带教人准备反馈"'],
        ['今日到期 T-0', '结束当天', '"XX的实操今天到期，请尽快填写反馈"'],
        ['逾期 T+1', '逾期1天', '"已逾期1天，请尽快跟进"'],
        ['逾期 T+3', '逾期3天', '"需管理层关注，存在劳动风险"'],
        ['反馈已提交', '带教人提交反馈', '"反馈已提交，请HR办理入职/结算"']
      ],
      [20, 25, 55]
    ),
    emptyLine(),

    heading('十三、劳动风险防控', HeadingLevel.HEADING_1),
    makeTable(
      ['红线', '时限', '违反后果'],
      [
        ['反馈须在结束后3工作日内提交', 'T+3', '升级管理层，触发风险预警'],
        ['通过后须在3工作日内签劳动合同', '反馈通过后3工作日', '系统标红预警'],
        ['超过5工作日未签合同', '反馈通过后5工作日', 'HR须书面说明原因，管理层审阅']
      ],
      [40, 30, 30]
    ),
    emptyLine(),
    warningBox('法律提示：根据《劳动合同法》，用人单位自用工之日起超过一个月不满一年未签书面劳动合同的，应当向劳动者每月支付二倍工资。'),
    emptyLine(),

    heading('十四、HR 权限总结', HeadingLevel.HEADING_1),
    makeTable(
      ['操作', '权限'],
      [
        [{ text: '可以', bold: true, color: COLORS.green }, ''],
        ['全量数据读写（含薪资、反馈、结算）', '可以'],
        ['账号管理（增删改）', '可以'],
        ['登录日志查看', '可以'],
        ['问卷处理', '可以'],
        ['登记实操人员', '可以'],
        ['填写反馈（代录）', '可以'],
        ['办理结算/入职', '可以'],
        ['删除记录', '可以'],
        ['导出完整数据', '可以'],
        [{ text: '注意', bold: true, color: COLORS.warningText }, ''],
        ['薪资管理', '本地工具，不上云']
      ],
      [70, 30]
    ),
    emptyLine(),

    heading('十五、HR 操作自查清单', HeadingLevel.HEADING_1),
    para('薪资登记自查：', { bold: true }),
    checkbox('本地工具已拉取最新云端数据'),
    checkbox('薪资结构已填写'),
    checkbox('基本工资已填写'),
    checkbox('谈薪备注已记录'),
    emptyLine(),
    para('办理入职自查：', { bold: true }),
    checkbox('带教反馈已提交且结果为"通过"'),
    checkbox('劳动合同已在3工作日内签订'),
    checkbox('入职日期已记录'),
    emptyLine(),
    para('办理结算自查：', { bold: true }),
    checkbox('带教反馈已提交且结果为"不通过"'),
    checkbox('结算金额已确认'),
    checkbox('结算日期已记录'),
  ];

  return new Document({
    creator: '实操台账系统',
    title: '人事操作SOP',
    description: '实操人员全生命周期管理 - HR侧标准操作流程',
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      children
    }]
  });
}

// ==================== Document 4: 系统操作指南 ====================
function buildSystemGuide() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
      children: [new TextRun({ text: '实操台账系统 · 完整操作指南', bold: true, size: 44, color: COLORS.primary })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '标准操作流程（SOP）+ 各角色系统操作指南', size: 24, color: '666666' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: '版本 v2.1  |  更新日期：2026年7月  |  适用角色：行政 / HR / 管理层 / 需求方 / 带教人', size: 20, color: '999999' })]
    }),

    // ===== Part 1: SOP =====
    heading('第一部分：标准操作流程（SOP）', HeadingLevel.HEADING_1),

    heading('一、流程概述', HeadingLevel.HEADING_2),

    heading('1.1 核心痛点与对策', HeadingLevel.HEADING_3),
    makeTable(
      ['痛点', '根因', '对应措施'],
      [
        ['实操已开始，人事还不知道有这个人', '无前置登记门槛', '问卷表单 + 双门禁制度'],
        ['高层介绍人来，不给带教人信息', '需求方信息不完整', '问卷表单必填带教人'],
        ['到了实操结束时间，还没同步结果', '反馈无人催、无人兜底', '企微群机器人四级提醒'],
        ['反馈来源混乱', '反馈出口不唯一', '带教人唯一反馈制'],
        ['没签劳动合同就实操', '入职流程无时限卡控', '劳动合同时限红线'],
        ['薪资信息泄露', '无权限隔离', '三端口权限隔离 + 薪资不上云']
      ],
      [30, 30, 40]
    ),
    emptyLine(),

    heading('1.2 流程总览', HeadingLevel.HEADING_3),
    para('整体流程：', { bold: true }),
    bullet('需求方填写问卷表单（免登录） → 企微群通知「新需求已提交」'),
    bullet('行政查看问卷 → 确认/修改信息 → 一键导入台账 → 企微群通知「新人员已登记」'),
    bullet('HR 在系统上登记薪资（薪资不上云，本地存储）'),
    bullet('实操进行中 ← 系统自动计算结束日期'),
    bullet('企微群机器人四级提醒（T-3 / T-0 / T+1 / T+3）'),
    bullet('带教人填写反馈表单（免登录，token 鉴权）'),
    bullet('通过 → HR 办理入职（签劳动合同）'),
    bullet('不通过 → HR 办理结算离场'),
    emptyLine(),

    heading('二、角色与职责', HeadingLevel.HEADING_2),
    makeTable(
      ['角色', '职责', '能看到的信息', '看不到的信息'],
      [
        ['需求方', '填写问卷表单', '自己提交的需求', '台账数据、薪资'],
        ['行政', '查看问卷 → 登记基础信息 + 设备', '姓名、带教人、日期、天数、设备', '薪资、反馈详情'],
        ['HR', '登记薪资、推进反馈、办理结算/入职', '全量数据（含薪资、反馈、结算）', '—'],
        ['带教人', '实操带教 + 填写反馈（唯一出口）', '自己带的实操人员姓名、日期', '薪资、其他人员信息'],
        ['管理层', '只读查看全部台账 + 问卷 + 账号管理', '全量数据（只读）', '—']
      ],
      [15, 25, 35, 25]
    ),
    emptyLine(),
    para('关键原则：', { bold: true }),
    bullet('需求方先填问卷：不管是谁安排实操人员，先通过问卷表单提交需求，行政再据此登记'),
    bullet('带教人 = 反馈唯一出口：不管谁介绍来的人，反馈只能由登记时指定的带教人提交'),
    bullet('薪资不上云：薪资信息存储在本地 HR 工具中，云端系统不含任何薪资字段'),
    bullet('企微群统一通知：所有关键节点都通过企微群机器人推送'),
    emptyLine(),

    heading('三、门禁规则', HeadingLevel.HEADING_2),
    para('门禁 1：信息完整性校验', { bold: true }),
    makeTable(
      ['校验项', '规则', '不通过的处理'],
      [
        ['带教人', '必填（问卷 + 登记）', '不予登记，提示先确认带教人'],
        ['实操人员姓名', '必填', '不予登记'],
        ['开始日期', '必填', '不予登记'],
        ['预计天数', '必填，≥1', '不予登记']
      ],
      [30, 40, 30]
    ),
    emptyLine(),
    para('门禁 2：薪资登记校验', { bold: true }),
    bullet('HR 在本地工具完成薪资登记后，系统标记为「薪资已登记」'),
    bullet('未登记薪资的人员，HR 应优先处理'),
    emptyLine(),

    heading('四、企微群机器人提醒机制', HeadingLevel.HEADING_2),
    para('通知场景：', { bold: true }),
    makeTable(
      ['场景', '触发时机', '通知内容（示例）'],
      [
        ['新需求提交', '需求方提交问卷', '"新的实操需求已提交：王总（管理层），实操人员张三，建议带教人李主管，请行政尽快登记"'],
        ['新人员登记', '行政导入问卷', '"新实操人员已登记：张三，带教人李主管，实操周期7/28~8/4（7天），请HR填写薪资"'],
        ['即将到期 T-3', '结束前3天', '"张三的实操还有3天到期（8/4），请带教人李主管准备反馈"'],
        ['今日到期 T-0', '结束当天', '"张三的实操今天到期，请带教人李主管尽快填写反馈表单"'],
        ['逾期 T+1', '逾期1天', '"张三的实操已逾期1天，带教人李主管尚未提交反馈，请尽快跟进"'],
        ['逾期 T+3', '逾期3天', '"张三的实操已逾期3天，存在劳动风险，请管理层跟进"'],
        ['反馈已提交', '带教人提交反馈', '"张三的实操反馈已由带教人李主管提交，结果：通过，请HR办理入职"']
      ],
      [15, 20, 65]
    ),
    emptyLine(),
    para('四级提醒升级：', { bold: true }),
    makeTable(
      ['时间节点', '提醒对象', '升级条件'],
      [
        ['T-3（结束前3天）', '带教人', '—'],
        ['T-0（结束当天）', '带教人 + HR', 'T-3 未响应'],
        ['T+1（逾期1天）', '带教人的上级', 'T-0 未响应'],
        ['T+3（逾期3天）', '管理层 + HR', 'T+1 未响应']
      ],
      [30, 35, 35]
    ),
    emptyLine(),

    heading('五、异常处理', HeadingLevel.HEADING_2),
    makeTable(
      ['异常场景', '处理方式', '责任人'],
      [
        ['需求方不给带教人信息', '问卷必填校验拦截；行政拒绝登记', '行政'],
        ['问卷提交后行政未及时处理', '企微群已通知，超1工作日 HR 跟进', '行政 → HR'],
        ['HR 超过1工作日未登记薪资', 'HR 自查本地工具待登记列表', 'HR'],
        ['带教人离职/调岗', 'HR 在系统中更新带教人后重新触发反馈', 'HR'],
        ['实操需延长', 'HR 修改预计天数，系统重算结束日期', 'HR'],
        ['实操中途终止', 'HR 直接办理结算，记录终止原因', 'HR'],
        ['反馈逾期3天未提交', '管理层介入，HR 评估是否按"不通过"处理', '管理层 + HR'],
        ['通过后5工作日未签合同', '系统标红预警，HR 须书面说明原因', 'HR']
      ],
      [35, 45, 20]
    ),
    emptyLine(),

    heading('六、劳动风险防控', HeadingLevel.HEADING_2),
    makeTable(
      ['红线', '时限', '违反后果'],
      [
        ['问卷必填带教人', '提交时', '系统拦截，无法提交'],
        ['反馈须在结束后3工作日内提交', 'T+3', '升级管理层，触发风险预警'],
        ['通过后须在3工作日内签劳动合同', '反馈通过后3工作日', '系统标红预警'],
        ['超过5工作日未签合同', '反馈通过后5工作日', 'HR 须书面说明原因，管理层审阅']
      ],
      [40, 30, 30]
    ),
    emptyLine(),
    warningBox('法律提示：根据《劳动合同法》，用人单位自用工之日起超过一个月不满一年未签书面劳动合同的，应当向劳动者每月支付二倍工资。'),
    emptyLine(),

    heading('七、信息安全与权限', HeadingLevel.HEADING_2),
    para('三层数据隔离架构：', { bold: true }),
    makeTable(
      ['层级', '存储位置', '包含数据', '访问方式'],
      [
        ['云端系统', '云服务器', '基础信息、设备、反馈、状态', '账号密码登录'],
        ['企微群机器人', '不存储数据', '仅推送通知消息', '群内可见'],
        ['本地 HR 工具', 'HR 电脑本地', '薪资结构、基本工资、补贴', 'HR 本地打开']
      ],
      [20, 20, 35, 25]
    ),
    emptyLine(),
    para('三端口权限矩阵：', { bold: true }),
    makeTable(
      ['数据项', '行政', 'HR', '管理层', '带教人', '需求方'],
      [
        ['问卷内容', '读写', '只读', '只读', '—', '只读(自己的)'],
        ['姓名', '读写', '读写', '只读', '只读(仅自己的)', '—'],
        ['带教人', '读写', '读写', '只读', '—', '—'],
        ['日期/天数', '读写', '读写', '只读', '—', '—'],
        ['设备信息', '读写', '只读', '只读', '—', '—'],
        [{ text: '薪资', color: COLORS.red, bold: true }, { text: '不可见', color: COLORS.red }, '本地读写', { text: '不可见', color: COLORS.red }, { text: '不可见', color: COLORS.red }, { text: '不可见', color: COLORS.red }],
        ['反馈结果', '不可见', '读写', '只读', '读写(仅自己的)', '—'],
        ['结算', '不可见', '读写', '只读', '不可见', '—']
      ],
      [20, 16, 16, 16, 16, 16]
    ),
    emptyLine(),
    pageBreak(),

    // ===== Part 2: Admin Guide =====
    heading('第二部分：系统操作指南 — 行政', HeadingLevel.HEADING_1),

    heading('1. 登录系统', HeadingLevel.HEADING_2),
    makeTable(
      ['字段', '填写内容'],
      [
        ['用户名', 'admin'],
        ['密码', 'admin123'],
        ['设备型号', '如：ThinkPad T14'],
        ['配件', '如：扩展坞、外接显示器'],
        ['序列号', '设备序列号']
      ],
      [30, 70]
    ),
    emptyLine(),
    warningBox('首次登录后请尽快修改密码。设备信息每次登录都会记录，用于审计追溯。'),
    emptyLine(),
    para('登录后界面包含：'),
    bullet('顶部栏：系统名称 + 「行政」角色标签 + 姓名 + 退出按钮'),
    bullet('统计卡片：总人数、实操中、待反馈、已反馈、需关注'),
    bullet('筛选标签：全部 / 实操中 / 待反馈 / 已反馈 / 已完结'),
    bullet('工具栏：搜索框 + 问卷需求 + 导出 + 登记实操人员'),
    bullet('数据表格：所有实操人员列表'),
    emptyLine(),

    heading('2. 处理问卷需求', HeadingLevel.HEADING_2),
    bullet('点击顶部「问卷需求」按钮'),
    bullet('查看待处理问卷列表'),
    bullet('确认问卷信息后点击「导入登记」'),
    bullet('系统自动带入问卷信息，行政确认/修改后点击「确认登记」'),
    bullet('如问卷无效，点击「忽略」'),
    emptyLine(),

    heading('3. 手动登记', HeadingLevel.HEADING_2),
    bullet('点击「登记实操人员」按钮'),
    bullet('填写信息后保存'),
    infoBox('建议优先使用问卷导入方式，确保信息来源可追溯。'),
    emptyLine(),

    heading('4. 编辑/详情/导出', HeadingLevel.HEADING_2),
    bullet('编辑：点击操作列「编辑」按钮，修改后保存'),
    bullet('详情：点击「详情」查看流程进度和基本信息（看不到薪资/反馈/结算金额）'),
    bullet('导出：点击「导出」下载 CSV（不含薪资）'),
    emptyLine(),

    heading('5. 行政权限边界', HeadingLevel.HEADING_2),
    makeTable(
      ['可以', '不可以'],
      [
        ['查看/处理问卷', '查看薪资金额'],
        ['登记实操人员', '查看反馈详情'],
        ['编辑基础信息', '查看结算金额'],
        ['查看流程状态', '填写反馈'],
        ['导出数据（无薪资）', '办理结算/入职'],
        ['', '管理账号']
      ],
      [50, 50]
    ),
    emptyLine(),
    pageBreak(),

    // ===== Part 3: HR Guide =====
    heading('第三部分：系统操作指南 — HR', HeadingLevel.HEADING_1),

    heading('1. 登录系统', HeadingLevel.HEADING_2),
    makeTable(
      ['字段', '填写内容'],
      [
        ['用户名', 'hr'],
        ['密码', 'hr666'],
        ['设备型号', '填写当前使用设备'],
        ['配件', '填写配件信息'],
        ['序列号', '填写设备序列号']
      ],
      [30, 70]
    ),
    emptyLine(),
    para('HR 登录后比行政多：账号管理、登录日志、薪资结构列、填写反馈/办理入职/办理结算/删除等操作按钮。'),
    emptyLine(),

    heading('2. 薪资登记（本地工具）', HeadingLevel.HEADING_2),
    warningBox('薪资绝不上云。薪资数据存储在 HR 本地电脑中，通过本地工具管理。'),
    emptyLine(),
    bullet('在 HR 电脑上用浏览器打开 hr-local.html'),
    bullet('输入云端系统地址和 HR 账号密码'),
    bullet('工具自动拉取云端台账数据'),
    bullet('为每条记录填写薪资信息（薪资结构、基本工资、补贴、备注）'),
    bullet('薪资数据存储在本地 localStorage 中，使用 AES 加密'),
    bullet('可随时导出 JSON 备份'),
    emptyLine(),
    warningBox('行政登记后 1 个工作日内完成薪资登记。'),
    emptyLine(),

    heading('3. 推进反馈', HeadingLevel.HEADING_2),
    bullet('HR 代录：找到目标人员 → 点击「填写反馈」→ 选择结果 → 填写意见 → 提交'),
    bullet('带教人自行提交：通过企微群链接填写，HR 无需介入'),
    infoBox('HR 代录的反馈标记为 hr_manual，带教人提交的标记为 mentor_form。'),
    emptyLine(),

    heading('4. 办理结算', HeadingLevel.HEADING_2),
    bullet('找到状态为「已反馈」且不通过的人员'),
    bullet('点击「办理结算」'),
    bullet('填写结算日期、金额（自动按日折算，可修改）、备注'),
    bullet('确认办理，状态变为「已结算」'),
    warningBox('反馈不通过后 3 个工作日内完成结算。'),
    emptyLine(),

    heading('5. 办理入职', HeadingLevel.HEADING_2),
    bullet('找到状态为「已反馈」且通过的人员'),
    bullet('点击「办理入职」'),
    bullet('填写入职日期、备注'),
    bullet('确认办理，状态变为「已入职」'),
    warningBox('反馈通过后 3 工作日内签劳动合同。超过 5 工作日未签，系统标红预警。'),
    emptyLine(),

    heading('6. 修改实操天数', HeadingLevel.HEADING_2),
    bullet('点击「编辑」→ 修改「预计实操天数」→ 系统重算结束日期 → 保存'),
    emptyLine(),

    heading('7. 账号管理', HeadingLevel.HEADING_2),
    bullet('查看所有账号：点击「账号管理」'),
    bullet('新增账号：填写用户名/密码/姓名/企微号/角色 → 点击「新增账号」'),
    bullet('删除账号：点击对应账号旁的「删除」（HR 可删除除 manager 外的所有账号）'),
    emptyLine(),

    heading('8. 登录日志', HeadingLevel.HEADING_2),
    bullet('点击「登录日志」查看所有登录记录（账号、设备、时间）'),
    emptyLine(),

    heading('9. HR 权限总结', HeadingLevel.HEADING_2),
    makeTable(
      ['操作', '权限'],
      [
        ['全量数据读写（含薪资、反馈、结算）', '可以'],
        ['账号管理（增删改）', '可以'],
        ['登录日志查看', '可以'],
        ['问卷处理', '可以'],
        ['登记实操人员', '可以'],
        ['填写反馈（代录）', '可以'],
        ['办理结算/入职', '可以'],
        ['删除记录', '可以'],
        ['导出完整数据', '可以'],
        ['薪资管理', '本地工具，不上云']
      ],
      [70, 30]
    ),
    emptyLine(),
    pageBreak(),

    // ===== Part 4: Manager Guide =====
    heading('第四部分：系统操作指南 — 管理层', HeadingLevel.HEADING_1),

    heading('1. 登录系统', HeadingLevel.HEADING_2),
    makeTable(
      ['字段', '填写内容'],
      [
        ['用户名', 'manager'],
        ['密码', 'mgr888'],
        ['设备型号', '填写当前使用设备'],
        ['配件', '填写配件信息'],
        ['序列号', '填写设备序列号']
      ],
      [30, 70]
    ),
    emptyLine(),
    para('管理层登录后为只读模式，可查看所有数据但不能编辑/登记/填写反馈。'),
    emptyLine(),

    heading('2. 查看台账数据', HeadingLevel.HEADING_2),
    bullet('统计概览：总人数、实操中、待反馈、已反馈、需关注'),
    bullet('筛选与搜索：点击标签切换视图，搜索框输入姓名/带教人'),
    bullet('查看详情：点击「详情」查看完整信息（含薪资、反馈、结算、入职）'),
    emptyLine(),

    heading('3. 查看问卷需求', HeadingLevel.HEADING_2),
    bullet('点击「问卷需求」查看所有问卷（只读，不能导入或忽略）'),
    emptyLine(),

    heading('4. 账号管理', HeadingLevel.HEADING_2),
    bullet('查看所有账号'),
    bullet('删除账号（可删除除 manager 外的所有账号，包括 HR）'),
    bullet('新增账号'),
    emptyLine(),

    heading('5. 管理层权限总结', HeadingLevel.HEADING_2),
    makeTable(
      ['操作', '权限'],
      [
        [{ text: '可以', bold: true, color: COLORS.green }, ''],
        ['全量数据只读（含薪资、反馈、结算）', '可以'],
        ['账号管理（增删，可删 HR）', '可以'],
        ['登录日志查看', '可以'],
        ['问卷查看（只读）', '可以'],
        ['导出完整数据', '可以'],
        ['删除记录', '可以'],
        [{ text: '不可以', bold: true, color: COLORS.red }, ''],
        ['登记实操人员', '不可以'],
        ['编辑记录', '不可以'],
        ['填写反馈', '不可以'],
        ['办理结算/入职', '不可以']
      ],
      [70, 30]
    ),
    emptyLine(),
    pageBreak(),

    // ===== Part 5: Questionnaire Guide =====
    heading('第五部分：需求方问卷指南', HeadingLevel.HEADING_1),
    para('适用对象：管理层、组长、员工 — 任何需要安排实操人员的人。'),
    emptyLine(),

    heading('操作步骤', HeadingLevel.HEADING_2),
    bullet('打开问卷表单（免登录，无需账号）'),
    bullet('填写：提交人姓名、身份、实操人员姓名、建议带教人（必填）、期望开始日期、预计天数'),
    bullet('选填：业务方向、设备需求、备注'),
    bullet('点击「提交需求」'),
    bullet('系统显示提交成功，企微群自动通知行政'),
    emptyLine(),
    warningBox('建议带教人必填！如果不知道带教人是谁，请先确认后再提交。'),
    emptyLine(),
    pageBreak(),

    // ===== Part 6: Feedback Guide =====
    heading('第六部分：带教人反馈指南', HeadingLevel.HEADING_1),
    para('适用对象：登记时指定的带教人。'),
    emptyLine(),

    heading('操作步骤', HeadingLevel.HEADING_2),
    bullet('收到提醒：实操到期前3天，企微群机器人推送提醒消息（含反馈链接）'),
    bullet('打开反馈表单：点击链接，无需账号密码（token 自动鉴权）'),
    bullet('确认信息：查看实操人员姓名、带教人、实操周期、预计天数'),
    bullet('填写反馈：'),
    para('实操结果：通过（建议入职）/ 不通过（结算离场）', { indent: 0.5 }),
    para('出勤天数、迟到次数、早退次数', { indent: 0.5 }),
    para('反馈意见（文字描述）', { indent: 0.5 }),
    bullet('点击「提交反馈」'),
    bullet('系统显示提交成功，企微群自动通知 HR'),
    emptyLine(),
    warningBox('反馈只能由带教人提交，不接受其他人代提交。反馈截止时间：实操结束后 3 个工作日内。超过 3 天未反馈，系统升级到管理层。'),
    emptyLine(),
    pageBreak(),

    // ===== Appendix =====
    heading('附录：账号、入口、FAQ', HeadingLevel.HEADING_1),

    heading('A1. 系统入口', HeadingLevel.HEADING_2),
    makeTable(
      ['入口', '地址', '使用者', '是否需要登录'],
      [
        ['问卷表单', '/questionnaire', '需求方', '免登录'],
        ['管理系统', '/', '行政/HR/管理层', '需账号密码'],
        ['反馈表单', '/feedback/:token', '带教人', '免登录（token鉴权）'],
        ['本地HR工具', 'hr-local.html（本地文件）', 'HR', '本地打开']
      ],
      [15, 30, 30, 25]
    ),
    emptyLine(),

    heading('A2. 系统账号', HeadingLevel.HEADING_2),
    makeTable(
      ['角色', '用户名', '密码', '权限'],
      [
        ['行政', 'admin', 'admin123', '登记/编辑基础信息'],
        ['HR', 'hr', 'hr666', '全量数据+账号管理'],
        ['管理层', 'manager', 'mgr888', '全量只读+账号管理']
      ],
      [15, 20, 20, 45]
    ),
    emptyLine(),
    warningBox('所有账号首次登录后请立即修改密码！'),
    emptyLine(),

    heading('A3. 状态说明', HeadingLevel.HEADING_2),
    makeTable(
      ['状态', '含义', '触发条件'],
      [
        ['实操中', '正在实操期间', '行政登记后'],
        ['待反馈', '实操已到期，等待带教人反馈', '到达结束日期'],
        ['已反馈', '带教人已提交反馈', '反馈提交后'],
        ['已结算', '不通过，已办理结算', 'HR 办理结算后'],
        ['已入职', '通过，已办理入职', 'HR 办理入职后']
      ],
      [15, 40, 45]
    ),
    emptyLine(),

    heading('A4. 常见问题', HeadingLevel.HEADING_2),
    makeTable(
      ['问题', '解答'],
      [
        ['忘记密码怎么办？', '联系 HR 或管理层，在「账号管理」中重置密码。'],
        ['需求方填了问卷但行政没处理？', '企微群会自动通知行政。超过1个工作日未处理，请联系行政或 HR。'],
        ['带教人离职了，谁来填反馈？', 'HR 在系统中编辑该人员记录，更新带教人后重新触发反馈。'],
        ['实操需要延长时间？', 'HR 在系统中编辑该人员，修改「预计实操天数」，系统自动重算结束日期。'],
        ['薪资数据安全吗？', '薪资数据完全不上云。存储在 HR 本地电脑中，使用 AES 加密。云端系统中根本不存在薪资字段。'],
        ['如何修改密码？', '联系 HR 或管理层在「账号管理」中操作。'],
        ['企微群没收到通知？', '检查：1.企微群机器人是否正常 2.Webhook 地址是否正确 3.服务器是否运行 4.联系技术人员'],
        ['导出的 CSV 打开乱码？', '用 Excel 打开时选择 UTF-8 编码，或用 WPS 直接打开。']
      ],
      [35, 65]
    ),
  ];

  return new Document({
    creator: '实操台账系统',
    title: '实操台账系统完整操作指南',
    description: 'SOP + 各角色系统操作指南',
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } },
      children
    }]
  });
}

// ==================== Generate All ====================

async function generateAll() {
  const outputDir = path.join(__dirname, 'docs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const documents = [
    { name: '需求方操作SOP.docx', builder: buildRequestorSOP },
    { name: '行政操作SOP.docx', builder: buildAdminSOP },
    { name: '人事操作SOP.docx', builder: buildHRSOP },
    { name: '系统操作指南(完整版).docx', builder: buildSystemGuide }
  ];

  for (const doc of documents) {
    const docObj = doc.builder();
    const buffer = await Packer.toBuffer(docObj);
    const filePath = path.join(outputDir, doc.name);
    fs.writeFileSync(filePath, buffer);
    console.log('Generated: ' + filePath + ' (' + Math.round(buffer.length / 1024) + ' KB)');
  }

  console.log('\nAll 4 Word documents generated successfully!');
}

generateAll().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
