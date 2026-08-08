const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'practice_ledger';
const COLL_NAME = 'appdata';

// 修复本地网络DNS不支持SRV解析的问题
// Render等云平台的DNS正常，此设置不影响
try {
  const testResolve = dns.resolveSrv;
  if (testResolve) {
    // 设置Google DNS作为备用，防止本地DNS(如VPN)不支持SRV记录
    const origServers = dns.getServers();
    // 添加公共DNS到列表末尾作为fallback
    dns.setServers([...new Set([...origServers, '8.8.8.8', '1.1.1.1'])]);
  }
} catch (e) {
  // 忽略DNS设置错误
}

// ==================== Password Utils ====================
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pwd, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return hash === verify;
}

// ==================== Default Data ====================
function getDefaultData() {
  return {
    accounts: [
      {
        id: 'A1',
        username: 'admin',
        password: hashPassword('Zz741852'),
        name: '行政专员',
        wecom: '',
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A2',
        username: 'hr',
        password: hashPassword('Zoe20260708'),
        name: '人事专员',
        wecom: '',
        role: 'hr',
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'A3',
        username: 'manager',
        password: hashPassword('4302055540j'),
        name: '管理层',
        wecom: '',
        role: 'manager',
        active: true,
        createdAt: new Date().toISOString()
      }
    ],
    records: [],
    questionnaires: [],
    loginLogs: []
  };
}

// ==================== Storage Backend ====================
let data = null;
let mongoClient = null;
let useMongo = false;
let mongoHealthy = false;  // 健康状态

// File-based fallback（仅在 MONGODB_URI 未配置时使用）
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!MONGODB_URI && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function connectMongo() {
  if (mongoClient && mongoHealthy) return mongoClient;
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  mongoHealthy = true;
  return mongoClient;
}

async function loadData() {
  if (MONGODB_URI) {
    // 强制使用MongoDB，不降级到文件存储（防止数据丢失）
    try {
      await connectMongo();
      const db = mongoClient.db(DB_NAME);
      const coll = db.collection(COLL_NAME);
      const doc = await coll.findOne({ _id: 'main' });
      if (!doc) {
        // 文档不存在：可能是首次启动，也可能是被外部清空
        // 安全策略：插入空种子数据但不覆盖MongoDB现有数据
        // 如果之前有数据被外部清空，需要从备份恢复
        console.warn('[DB] MongoDB: 文档不存在，初始化为种子数据');
        data = getDefaultData();
        await coll.insertOne({ _id: 'main', data });
        console.log('[DB] MongoDB: 初始化种子数据 records=0');
      } else {
        data = doc.data;
        console.log('[DB] MongoDB: 加载成功 records=' + (data.records ? data.records.length : 0));
      }
      useMongo = true;
      return data;
    } catch (e) {
      // MongoDB失败时，保留内存数据，宁可报错也不覆盖MongoDB数据
      console.error('[DB] MongoDB连接失败:', e.message);
      mongoHealthy = false;
      throw new Error('数据库连接失败，请稍后重试');
    }
  }

  // 文件存储（仅在 MONGODB_URI 未配置时使用）
  if (!fs.existsSync(DB_FILE)) {
    data = getDefaultData();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  console.log('[DB] 文件存储: 加载成功 records=' + (data.records ? data.records.length : 0));
  return data;
}

async function saveData() {
  if (!data) return;

  if (useMongo && MONGODB_URI) {
    // 重试3次，每次间隔增加
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!mongoHealthy) await connectMongo();
        const db = mongoClient.db(DB_NAME);
        const coll = db.collection(COLL_NAME);
        await coll.updateOne({ _id: 'main' }, { $set: { data } });
        return;  // 成功
      } catch (e) {
        console.error(`[DB] MongoDB保存失败(第${attempt}次):`, e.message);
        mongoHealthy = false;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));  // 等待后重试
        } else {
          throw new Error('数据保存失败，请稍后重试');
        }
      }
    }
  } else if (!MONGODB_URI) {
    // 仅在未配置MongoDB时使用文件存储
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } else {
    throw new Error('数据库不可用，请稍后重试');
  }
}

function getData() {
  if (!data) {
    throw new Error('数据库尚未加载完成');
  }
  return data;
}

async function closeDb() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    mongoHealthy = false;
  }
}

module.exports = { getData, saveData, hashPassword, verifyPassword, loadData, closeDb };