const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadData } = require('./lib/db');
const { startScheduler, checkAndNotifyDeadlines, getDiagnosticInfo } = require('./lib/wecom-bot');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: allow local HR tool (file:// or other localhost preview origins) to call API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 请求级调度器：每次有请求进来时检查是否需要发送定时通知
// 这样即使 Render 免费版从休眠中唤醒，也能立即执行检查
let lastCheckTime = 0;
const CHECK_INTERVAL = 5 * 60 * 1000; // 最少间隔5分钟
app.use((req, res, next) => {
  const now = Date.now();
  if (now - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = now;
    // 异步执行，不阻塞请求
    setImmediate(() => {
      try {
        checkAndNotifyDeadlines();
      } catch (e) {
        console.error('[RequestScheduler] Check error:', e.message);
      }
    });
  }
  next();
});

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/records', require('./routes/records'));
app.use('/api/questionnaire', require('./routes/questionnaire'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 诊断端点：检查环境变量配置状态（无需登录）
app.get('/api/diagnostic', (req, res) => {
  const info = getDiagnosticInfo();
  const { getData } = require('./lib/db');
  const data = getData();
  const today = new Date().toISOString().slice(0, 10);
  const activeRecords = data.records.filter(r => r.status === 'practicing' || r.status === 'feedback_pending');
  const recordSummaries = activeRecords.map(r => {
    const daysDiff = Math.round((new Date(r.endDate) - new Date(today)) / 86400000);
    return {
      id: r.id,
      name: r.name,
      endDate: r.endDate,
      practiceDays: r.practiceDays,
      status: r.status,
      daysRemaining: daysDiff,
      notified_t3: !!r.notified_t3,
      notified_t1: !!r.notified_t1,
      notified_t0: !!r.notified_t0,
      notified_over7: !!r.notified_over7,
      notified_overdue3: !!r.notified_overdue3
    };
  });
  res.json({
    env: info,
    totalRecords: data.records.length,
    activeRecords: activeRecords.length,
    records: recordSummaries,
    serverTime: new Date().toISOString(),
    note: '如果 UserID 显示 (empty)，说明环境变量未设置，@功能将不生效'
  });
});

// 手动触发定时检查（需要登录）
app.get('/api/trigger-check', (req, res) => {
  try {
    const count = checkAndNotifyDeadlines();
    res.json({ success: true, notificationsSent: count, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/feedback/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
});

app.get('/questionnaire', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'questionnaire.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

loadData();
startScheduler();

app.listen(PORT, () => {
  const diag = getDiagnosticInfo();
  console.log('========================================');
  console.log('  实操台账管理系统已启动');
  console.log('  地址: http://localhost:' + PORT);
  console.log('  问卷表单: http://localhost:' + PORT + '/questionnaire');
  console.log('  账号:');
  console.log('    行政: admin / admin123 (莫青霖)');
  console.log('    SSC:  hr / hr666 (Zoe)');
  console.log('    HRD:  manager / mgr888 (massie)');
  console.log('  企微机器人: ' + (diag.webhookConfigured ? '已配置' : '未配置(设置 WECOM_BOT_WEBHOOK 环境变量)'));
  console.log('  SSC UserID: ' + diag.hrUserId);
  console.log('  HRD UserID: ' + diag.managerUserId);
  console.log('  Admin UserID: ' + diag.adminUserId);
  console.log('  云端地址: ' + diag.cloudBaseUrl);
  console.log('  诊断端点: /api/diagnostic');
  console.log('  手动检查: /api/trigger-check');
  console.log('========================================');
});
