const express = require('express');
const nodemailer = require('nodemailer');
const { getData, saveData } = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { sendMarkdown } = require('../lib/wecom-bot');

const router = express.Router();

// ==================== SMTP 配置（环境变量，密码不入代码库） ====================
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.exmail.qq.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';           // HR_Support@insightelectionhk.com
const SMTP_PASS = process.env.SMTP_PASS || '';           // 由管理员在 Render 环境变量自行填写
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || '人力资源部'; // 发件显示名（对外脱敏，不含品牌）

// ==================== 简单限流：每账号每天 50 封（内存级，重启清零） ====================
const DAILY_LIMIT = 50;
const sendCounters = new Map(); // key: accountId, value: { date, count }

function checkRateLimit(accountId) {
  const today = new Date().toISOString().slice(0, 10);
  let counter = sendCounters.get(accountId);
  if (!counter || counter.date !== today) {
    counter = { date: today, count: 0 };
    sendCounters.set(accountId, counter);
  }
  return counter.count < DAILY_LIMIT;
}

function bumpRateLimit(accountId) {
  const today = new Date().toISOString().slice(0, 10);
  const counter = sendCounters.get(accountId) || { date: today, count: 0 };
  counter.count += 1;
  sendCounters.set(accountId, counter);
}

// ==================== 邮箱格式校验 ====================
function isValidEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// 惰性创建 transporter（避免未配置时启动报错）
let transporter = null;
function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    const err = new Error('SMTP 未配置：请在服务端环境变量中设置 SMTP_USER 与 SMTP_PASS');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }
  return transporter;
}

// ==================== 发送接口 ====================
// POST /api/invite/send
// body: { to, subject, body, candidateName, jobTitle, mode }（mode: offline|online）
router.post('/send', authMiddleware, requireRole('hr', 'manager', 'admin'), async (req, res) => {
  try {
    const { to, subject, body, candidateName, jobTitle, mode } = req.body;

    // ---- 参数校验 ----
    if (!to || !isValidEmail(to)) {
      return res.status(400).json({ error: '收件人邮箱格式不正确' });
    }
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ error: '邮件主题不能为空' });
    }
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ error: '邮件正文不能为空' });
    }
    if (subject.length > 200) {
      return res.status(400).json({ error: '邮件主题过长' });
    }
    if (body.length > 20000) {
      return res.status(400).json({ error: '邮件正文过长' });
    }

    // ---- 占位符检查：防止把 {{填}} 发出去 ----
    if (/\{\{[^}]*\}\}/.test(subject) || /\{\{[^}]*\}\}/.test(body)) {
      return res.status(400).json({ error: '邮件内容包含未填写的占位符（{{ }}），请补全后再发送' });
    }

    // ---- 限流 ----
    if (!checkRateLimit(req.user.id)) {
      return res.status(429).json({ error: `今日发送已达上限（${DAILY_LIMIT} 封），请明天再试` });
    }

    // ---- 发送 ----
    const info = await getTransporter().sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_USER}>`,
      to,
      subject: subject.trim(),
      text: body
    });

    bumpRateLimit(req.user.id);

    // ---- 写台账 ----
    const data = getData();
    if (!Array.isArray(data.inviteLogs)) data.inviteLogs = [];
    const log = {
      id: 'IV' + Date.now().toString(36),
      to,
      subject: subject.trim(),
      candidateName: candidateName || '',
      jobTitle: jobTitle || '',
      mode: mode === 'online' ? 'online' : 'offline',
      sentBy: req.user.name,
      sentByUsername: req.user.username,
      sentAt: new Date().toISOString(),
      messageId: info.messageId || '',
      status: 'sent'
    };
    data.inviteLogs.push(log);
    if (data.inviteLogs.length > 5000) data.inviteLogs = data.inviteLogs.slice(-5000);
    await saveData();

    // ---- 群回执（复用现有 Webhook，不阻塞响应） ----
    try {
      sendMarkdown(`**面试邀约已发送**\n> 候选人：${candidateName || to}\n> 岗位：${jobTitle || '—'}\n> 形式：${mode === 'online' ? '线上面试' : '线下面试'}\n> 操作人：${req.user.name}\n> 时间：${log.sentAt.replace('T', ' ').slice(0, 16)}`);
    } catch (e) {
      console.error('[Invite] Webhook receipt failed:', e.message);
    }

    res.json({ success: true, log });
  } catch (e) {
    if (e.code === 'SMTP_NOT_CONFIGURED') {
      return res.status(503).json({ error: e.message });
    }
    console.error('[Invite] Send failed:', e.message);
    res.status(500).json({ error: '邮件发送失败：' + (e.response || e.message) });
  }
});

// ==================== 发送记录查询 ====================
// GET /api/invite/logs
router.get('/logs', authMiddleware, requireRole('hr', 'manager', 'admin'), (req, res) => {
  const data = getData();
  const logs = (data.inviteLogs || []).slice().reverse().slice(0, 200);
  res.json({ logs, total: (data.inviteLogs || []).length });
});

module.exports = router;
