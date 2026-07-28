const express = require('express');
const path = require('path');
const { loadData } = require('./lib/db');
const { startScheduler } = require('./lib/wecom-bot');

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

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/records', require('./routes/records'));
app.use('/api/questionnaire', require('./routes/questionnaire'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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
  console.log('========================================');
  console.log('  实操台账管理系统已启动');
  console.log('  地址: http://localhost:' + PORT);
  console.log('  问卷表单: http://localhost:' + PORT + '/questionnaire');
  console.log('  账号:');
  console.log('    行政: admin / admin123');
  console.log('    HR:   hr / hr666');
  console.log('    管理: manager / mgr888');
  console.log('  企微机器人: ' + (process.env.WECOM_BOT_WEBHOOK ? '已配置' : '未配置(设置 WECOM_BOT_WEBHOOK 环境变量)'));
  console.log('========================================');
});
