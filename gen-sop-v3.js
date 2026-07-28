const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber, ImageRun
} = require('docx');
const fs = require('fs');
const path = require('path');

// ==================== Style helpers ====================
const FONT = 'Microsoft YaHei';
const BLUE = '1a56c4';
const DARK = '1a1a2e';
const GRAY = '666666';
const RED = 'dc2626';
const GREEN = '16a34a';
const ORANGE = 'ea580c';
const LIGHT_BG = 'f0f4ff';
const WARN_BG = 'fff3e0';
const DANGER_BG = 'fce4ec';

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 32, color: BLUE, font: FONT })]
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, color: BLUE, font: FONT })]
  });
}

function h3(text) {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true, size: 22, color: DARK, font: FONT })]
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text, size: 21, font: FONT, ...opts })]
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    bullet: { level },
    children: [new TextRun({ text, size: 21, font: FONT })]
  });
}

function warningBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: DANGER_BG },
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({
          children: [new TextRun({ text, size: 21, font: FONT, color: RED, bold: true })]
        })]
      })]
    })]
  });
}

function tipBox(text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: LIGHT_BG },
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({
          children: [new TextRun({ text, size: 21, font: FONT, color: BLUE })]
        })]
      })]
    })]
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { before: 80, after: 80 }, children: [] });
}

// Table helpers
function tableHeaderCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: BLUE },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 20, color: 'FFFFFF', font: FONT })]
    })]
  });
}

function tableCell(text, opts = {}) {
  return new TableCell({
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    children: [new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), size: 20, font: FONT, bold: opts.bold, color: opts.color || DARK })]
    })]
  });
}

function makeTable(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(100 / headers.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h, i) => tableHeaderCell(h, w[i])) }),
      ...rows.map((row, ri) => new TableRow({
        children: row.map((cell, ci) => {
          const opts = typeof cell === 'object' ? cell : { text: cell };
          return tableCell(opts.text || cell, {
            ...opts,
            fill: ri % 2 === 1 ? 'f5f7fa' : (opts.fill || undefined)
          });
        })
      }))
    ]
  });
}

// ==================== Document 1: 简版SOP ====================
function createSOP() {
  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21 },
          paragraph: { spacing: { before: 60, after: 60 } }
        }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: '实操人员管理SOP v3.0', size: 16, color: GRAY, font: FONT })]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: '第 ', size: 16, color: GRAY, font: FONT }),
                       new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: FONT }),
                       new TextRun({ text: ' 页', size: 16, color: GRAY, font: FONT })]
          })]
        })
      },
      children: [
        // Title
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: '实操人员全流程管理SOP', bold: true, size: 40, color: BLUE, font: FONT })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 200 },
          children: [new TextRun({ text: 'Version 3.0  |  2026年7月', size: 20, color: GRAY, font: FONT })]
        }),

        // §1 流程总览
        h1('一、流程总览'),
        p('实操人员从需求提交到入职/离场，共5个阶段，全流程通过企微群机器人自动驱动：'),
        emptyLine(),
        makeTable(
          ['阶段', '动作', '负责人', '企微通知', '时间节点'],
          [
            [{text:'1. 需求提交', bold:true}, '填写问卷表单（姓名、带教人、天数等）', '需求方/管理层', '@全员', '入职前≥3天'],
            [{text:'2. 行政登记', bold:true}, '查看问卷→导入登记→补充设备信息', '行政', '@全员', '实操首日'],
            [{text:'3. SSC录入', bold:true}, '填写薪资信息（本地工具，不上云）', 'SSC', '—', '实操首日'],
            [{text:'4. 到期跟进', bold:true}, '跟进带教人反馈→SSC记录结果+上传凭证', 'SSC/带教人', '@Zoe（T-3/T-1）', '结束前3天起'],
            [{text:'5. 入职/结算', bold:true}, '通过→办理入职 / 不通过→薪资结算', 'SSC', '@massie+@Zoe', '反馈当天'],
          ],
          [15, 30, 15, 20, 20]
        ),
        emptyLine(),

        // §2 关键规则
        h1('二、关键规则'),
        h3('2.1 实操天数限制'),
        p('实操天数建议不超过7天。超过7天存在用工风险（事实劳动关系、劳动仲裁等），系统会在登记时自动预警并通知企微群。'),
        warningBox('红线：实操天数 > 7天 → 系统自动发送用工风险预警到企微群@全员'),
        emptyLine(),

        h3('2.2 提前同步要求'),
        p('需求方须在实操人员入职前至少提前3天提交问卷或直接报给行政，确保行政有足够时间准备设备、SSC有足够时间录入薪资。需求方可自行填写问卷表单，或通知行政代为登记。'),
        emptyLine(),

        h3('2.3 薪资保密原则'),
        p('薪资信息属于保密数据，绝不上云。薪资通过本地SSC工具管理，数据加密存储在SSC个人电脑，云端系统不含任何薪资字段。'),
        emptyLine(),

        // §3 企微机器人通知规则
        h1('三、企微群机器人通知规则'),
        p('以下所有通知由系统自动推送，无需人工干预：'),
        emptyLine(),
        makeTable(
          ['触发事件', '通知内容', '@对象'],
          [
            [{text:'问卷提交', bold:true}, '新实操需求已提交，请行政尽快登记', '@全员'],
            [{text:'行政登记', bold:true}, '新实操人员已登记，请SSC填写薪资', '@全员'],
            [{text:'天数>7天', bold:true}, '实操天数超过7天，存在用工风险', '@全员'],
            [{text:'结束前3天', bold:true}, 'XX实操还有3天结束，请跟进反馈', '@Zoe'],
            [{text:'结束前1天', bold:true}, 'XX实操还剩1天，请务必完成反馈记录', '@Zoe'],
            [{text:'结束当天', bold:true}, 'XX实操今天到期，请填写反馈', '带教人'],
            [{text:'逾期3天', bold:true}, '已逾期3天，需管理层关注，存在劳动风险', '@全员'],
            [{text:'反馈提交', bold:true}, '反馈结果已提交（通过/不通过）', '@massie'],
            [{text:'办理入职', bold:true}, 'XX已通过实操，请办理正式入职', '@massie+@Zoe'],
          ],
          [20, 55, 25]
        ),
        emptyLine(),

        // §4 角色职责
        h1('四、角色职责'),
        makeTable(
          ['角色', '核心职责', '系统权限'],
          [
            [{text:'需求方', bold:true}, '提交实操需求问卷', '免登录填写问卷'],
            [{text:'行政', bold:true}, '处理问卷→登记设备信息→跟踪状态', '登记/编辑/查看（无薪资）'],
            [{text:'SSC', bold:true}, '录入薪资→跟进反馈→办理入职/结算→账号管理', '全量读写（薪资在本地）'],
            [{text:'带教人', bold:true}, '填写实操反馈表单（免登录）', '仅反馈表单'],
            [{text:'管理层', bold:true}, '查看全量数据→审批→账号管理', '只读全量'],
          ],
          [15, 50, 35]
        ),
        emptyLine(),

        // §5 异常处理
        h1('五、异常处理'),
        makeTable(
          ['异常场景', '处理方式', '责任人'],
          [
            ['实操天数需超过7天', '须管理层审批，签署知情同意书', '管理层+SSC'],
            ['到期未收到反馈', 'T+3自动@全员预警，SSC介入联系带教人', 'SSC'],
            ['反馈不通过', 'SSC办理薪资结算（金额在本地工具），人员离场', 'SSC'],
            ['反馈通过但未入职', '持续@massie和@Zoe提醒，直到入职完成', '系统自动'],
            ['纸质反馈表', 'SSC拍照上传到系统作为凭证附件', 'SSC'],
          ],
          [25, 50, 25]
        ),
        emptyLine(),

        // §6 劳动风险防控
        h1('六、劳动风险防控'),
        bullet('实操天数严格控制在7天以内，超过需管理层审批'),
        bullet('实操期间不签订劳动合同，以"实操评估"名义进行'),
        bullet('实操结束当天必须有明确结论：通过→入职 或 不通过→结算离场'),
        bullet('逾期未反馈的，T+3自动升级到管理层+劳动风险预警'),
        bullet('薪资数据绝不上云，物理隔离，防止数据泄露'),
        bullet('所有操作留痕，系统记录操作人、时间、来源'),
        emptyLine(),

        // §7 系统入口
        h1('七、系统入口'),
        makeTable(
          ['入口', '地址', '说明'],
          [
            ['问卷表单', '/questionnaire', '免登录，需求方填写'],
            ['管理后台', '/', '行政/SSC/管理层登录'],
            ['反馈表单', '/feedback/:token', '带教人免登录填写'],
            ['本地SSC工具', 'hr-local.html', '薪资管理，不上云'],
          ],
          [20, 35, 45]
        ),
        emptyLine(),
        tipBox('提示：部署上线后，将上述地址替换为实际域名。Zoe和massie为企微UserID，需在.env中配置实际值。'),
      ]
    }]
  });
}

// ==================== Document 2: 领导决策版 ====================
function createLeadershipGuide() {
  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21 },
          paragraph: { spacing: { before: 60, after: 60 } }
        }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } }
      },
      children: [
        // Title
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 300, after: 80 },
          children: [new TextRun({ text: '实操台账系统', bold: true, size: 44, color: BLUE, font: FONT })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 300 },
          children: [new TextRun({ text: '领导决策摘要', size: 24, color: GRAY, font: FONT })]
        }),

        // 核心价值
        h2('核心价值'),
        p('一套系统解决实操人员从需求到入职的全流程管理，自动驱动各角色按时完成操作，杜绝信息不同步、反馈遗漏、用工风险。'),
        emptyLine(),

        // 流程图（精简）
        h2('流程一览'),
        p('问卷提交(@全员) → 行政登记 → SSC录薪 → 到期跟进(@Zoe) → 反馈结果(@massie) → 入职/结算', { bold: true, color: BLUE }),
        p('全流程由企微群机器人自动驱动，无需人工催办。'),
        emptyLine(),

        // 关键数据
        h2('关键指标'),
        makeTable(
          ['指标', '规则', '原因'],
          [
            [{text:'实操天数上限', bold:true, color:RED}, '7天', '超过7天产生事实劳动关系风险'],
            [{text:'提前提交', bold:true}, '≥3天', '需求方须提前3天报给行政或自行填写问卷'],
            [{text:'跟进提醒', bold:true, color:ORANGE}, 'T-3 @Zoe / T-1 @Zoe', '确保反馈不遗漏'],
            [{text:'结果通知', bold:true}, '@massie', '确保管理层知晓结果'],
            [{text:'入职通知', bold:true}, '@massie + @Zoe', '确保入职流程不遗漏'],
          ],
          [25, 35, 40]
        ),
        emptyLine(),

        // 三层数据隔离
        h2('数据安全'),
        makeTable(
          ['层级', '存储内容', '位置'],
          [
            [{text:'云端系统', bold:true}, '姓名/带教/日期/设备/反馈/状态', '云服务器'],
            [{text:'企微机器人', bold:true}, '只发提醒，不存数据', '企微群'],
            [{text:'本地SSC工具', bold:true, color:RED}, '薪资结构/金额', 'SSC个人电脑（加密）'],
          ],
          [25, 45, 30]
        ),
        p('薪资数据物理隔离，绝不上云。', { color: RED, bold: true }),
        emptyLine(),

        // 角色权限
        h2('角色权限'),
        makeTable(
          ['角色', '权限', '关注点'],
          [
            ['行政', '登记/编辑', '设备信息、实操周期'],
            ['SSC', '全量读写', '薪资、反馈、入职/结算'],
            ['管理层', '只读全量', '统计数据、风险预警'],
          ],
          [20, 30, 50]
        ),
        emptyLine(),

        // 决策点
        h2('管理层决策点'),
        bullet('实操天数 > 7天时，是否批准？须签署知情同意书'),
        bullet('反馈不通过时，确认薪资结算金额（SSC在本地工具操作）'),
        bullet('逾期3天未反馈时，是否需要直接介入处理'),
        emptyLine(),

        // 投入
        h2('部署需求'),
        bullet('云端服务器（Render.com免费版即可）'),
        bullet('企微群机器人（已配置）'),
        bullet('SSC个人电脑（运行本地薪资工具）'),
        bullet('系统账号：admin（行政）/ hr（SSC）/ manager（管理层）'),
        emptyLine(),
        tipBox('系统已在本地跑通，仅需部署到云端即可对外使用。'),
      ]
    }]
  });
}

// ==================== Generate ====================
async function generate() {
  const outDir = path.join(__dirname, 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // SOP
  const sopDoc = createSOP();
  const sopBuf = await Packer.toBuffer(sopDoc);
  const sopPath = path.join(outDir, '实操人员管理SOP_v3_简版.docx');
  fs.writeFileSync(sopPath, sopBuf);
  console.log('SOP generated:', sopPath, sopBuf.length, 'bytes');

  // Leadership guide
  const leadDoc = createLeadershipGuide();
  const leadBuf = await Packer.toBuffer(leadDoc);
  const leadPath = path.join(outDir, '领导决策摘要.docx');
  fs.writeFileSync(leadPath, leadBuf);
  console.log('Leadership guide generated:', leadPath, leadBuf.length, 'bytes');

  console.log('\nDone! Files in:', outDir);
}

generate().catch(e => { console.error(e); process.exit(1); });
